#!/usr/bin/env python3
"""
scraper_fragrantica.py — Fuente 1 de la base de perfumes.

Extrae fichas de perfumes de Fragrantica con Playwright (el sitio
renderiza partes con JavaScript). Exporta JSON por lotes de 500 para
revisión manual antes de normalizar y cargar a Firestore.

Modos:
  python scraper_fragrantica.py --inicial --familia Oriental
  python scraper_fragrantica.py --inicial --letra A
  python scraper_fragrantica.py --incremental --desde salida/

Comportamiento:
  - Delay aleatorio de 2 a 4 segundos entre requests (no saturar el sitio).
  - Log de errores y perfumes no procesados en errores.log.
  - Modo incremental: solo procesa URLs que no estén en los JSON previos.

Nota legal: revisá los términos de uso y robots.txt de Fragrantica antes
de correr el scraper, y mantené el volumen y la frecuencia al mínimo
necesario. La alternativa recomendada si no es viable: datasets públicos
(ver dataset_adapter.py).
"""

import argparse
import json
import logging
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

BASE_URL = "https://www.fragrantica.com"  # override con FRAGRANTICA_BASE_URL
TAMANO_LOTE = 500
DELAY_MIN, DELAY_MAX = 2.0, 4.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler("errores.log"), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("scraper")


def dormir():
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def slug_id(url: str) -> str:
    """ID estable derivado de la URL del perfume (p.ej. perfume/Dior/Sauvage-31861)."""
    m = re.search(r"/perfume/([^/]+)/([^/.]+)", url)
    if not m:
        return re.sub(r"\W+", "-", url)[-80:]
    return f"{m.group(1)}__{m.group(2)}".lower()


def extraer_listado(page, url_listado: str) -> list[str]:
    """Devuelve las URLs de perfumes de una página de listado (con paginación)."""
    urls = []
    pagina = 1
    while True:
        destino = f"{url_listado}?page={pagina}" if pagina > 1 else url_listado
        log.info("Listado: %s", destino)
        page.goto(destino, wait_until="domcontentloaded", timeout=60000)
        dormir()
        soup = BeautifulSoup(page.content(), "html.parser")
        enlaces = [
            a["href"] for a in soup.select("a[href*='/perfume/']")
            if re.search(r"/perfume/[^/]+/[^/]+\.html", a.get("href", ""))
        ]
        nuevos = [e if e.startswith("http") else BASE_URL + e for e in enlaces]
        nuevos = [u for u in dict.fromkeys(nuevos) if u not in urls]
        if not nuevos:
            break
        urls.extend(nuevos)
        pagina += 1
    return urls


def parsear_ficha(html: str, url: str) -> dict:
    """Parsea la ficha de un perfume al esquema crudo (pre-normalización)."""
    soup = BeautifulSoup(html, "html.parser")

    def texto(sel):
        el = soup.select_one(sel)
        return el.get_text(strip=True) if el else None

    nombre_completo = texto("h1") or ""
    # El h1 suele ser "Nombre Marca para Hombres/Mujeres"
    genero = "U"
    if re.search(r"para Hombres y Mujeres|for women and men", nombre_completo, re.I):
        genero = "U"
    elif re.search(r"para Hombres|for men", nombre_completo, re.I):
        genero = "M"
    elif re.search(r"para Mujeres|for women", nombre_completo, re.I):
        genero = "F"

    marca = texto("p[itemprop='brand'] span[itemprop='name']") or texto(".breadcrumb a:nth-of-type(2)")
    nombre = re.sub(
        r"\s+(para|for)\s+(Hombres y Mujeres|Hombres|Mujeres|women and men|men|women).*$",
        "",
        nombre_completo,
        flags=re.I,
    )
    if marca:
        nombre = re.sub(rf"\s*{re.escape(marca)}\s*$", "", nombre).strip()

    anio = None
    m_anio = re.search(r"\b(19|20)\d{2}\b", nombre_completo + " " + (texto("#info") or ""))
    if m_anio:
        anio = int(m_anio.group(0))

    concentracion = None
    for c in ("Parfum", "EDP", "EDT", "EDC", "Splash", "Eau de Parfum", "Eau de Toilette"):
        if c.lower() in nombre_completo.lower():
            concentracion = {"Eau de Parfum": "EDP", "Eau de Toilette": "EDT"}.get(c, c)
            break

    def notas(seccion):
        # Las pirámides aparecen en bloques con encabezado "Notas de Salida/Corazón/Fondo"
        encabezado = soup.find(string=re.compile(seccion, re.I))
        if not encabezado:
            return []
        contenedor = encabezado.find_parent()
        if not contenedor:
            return []
        sibling = contenedor.find_next_sibling()
        if not sibling:
            return []
        return [t.get_text(strip=True) for t in sibling.select("div, span") if t.get_text(strip=True)][:15]

    rating = None
    votos = 0
    el_rating = soup.select_one("span[itemprop='ratingValue']")
    el_votos = soup.select_one("span[itemprop='ratingCount'], span[itemprop='reviewCount']")
    if el_rating:
        try:
            rating = float(el_rating.get_text(strip=True).replace(",", ".")) * 2  # escala 0-10
        except ValueError:
            pass
    if el_votos:
        try:
            votos = int(re.sub(r"\D", "", el_votos.get_text()))
        except ValueError:
            pass

    # Descriptores de la comunidad: los vote-buttons de "main accords"
    descriptores = [
        d.get_text(strip=True).lower()
        for d in soup.select(".accord-bar")
    ][:10]

    imagen = soup.select_one("img[itemprop='image'], #mainpicbox img")
    imagen_url = imagen["src"] if imagen and imagen.get("src") else None

    # Familia: Fragrantica la expone en los breadcrumbs/grupo
    familia = None
    grupo = soup.find(string=re.compile(r"(Grupo olfativo|main accords|olfactive family)", re.I))
    if grupo:
        familia = grupo.find_next(string=True)
    if not familia and descriptores:
        familia = descriptores[0].capitalize()

    discontinuado = bool(
        soup.find(string=re.compile(r"(discontinu|descatalogado)", re.I))
    )

    return {
        "id": slug_id(url),
        "nombre": nombre.strip(),
        "marca": (marca or "").strip(),
        "anio": anio,
        "genero": genero,
        "concentracion": concentracion,
        "familia_principal": (familia or "").strip() or None,
        "familias_secundarias": [],
        "notas_salida": notas(r"Notas de Salida|Top Notes"),
        "notas_corazon": notas(r"Notas de Coraz|Middle Notes|Heart Notes"),
        "notas_fondo": notas(r"Notas de Fondo|Base Notes"),
        "descriptores": descriptores,
        "rating": rating,
        "votos": votos,
        "discontinuado": discontinuado,
        "imagen_url": imagen_url,
        "url_fragrantica": url,
        "scrapeado_at": datetime.now(timezone.utc).isoformat(),
    }


def cargar_ids_previos(directorio: Path) -> set[str]:
    ids = set()
    for archivo in directorio.glob("perfumes_*.json"):
        with open(archivo, encoding="utf-8") as f:
            for p in json.load(f):
                ids.add(p["id"])
    return ids


def exportar_lote(perfumes: list[dict], salida: Path, numero: int):
    salida.mkdir(parents=True, exist_ok=True)
    archivo = salida / f"perfumes_{numero:04d}.json"
    with open(archivo, "w", encoding="utf-8") as f:
        json.dump(perfumes, f, ensure_ascii=False, indent=2)
    log.info("Lote exportado: %s (%d perfumes)", archivo, len(perfumes))


def main():
    parser = argparse.ArgumentParser(description="Scraper de Fragrantica")
    grupo_modo = parser.add_mutually_exclusive_group(required=True)
    grupo_modo.add_argument("--inicial", action="store_true", help="scraping desde cero")
    grupo_modo.add_argument("--incremental", action="store_true", help="solo perfumes nuevos")
    parser.add_argument("--familia", help="grupo olfativo a recorrer (ej: Oriental)")
    parser.add_argument("--letra", help="letra inicial de marca (ej: A)")
    parser.add_argument("--desde", default="salida", help="directorio con JSON previos")
    parser.add_argument("--salida", default="salida", help="directorio de export")
    parser.add_argument("--base-url", default=None, help="override de FRAGRANTICA_BASE_URL")
    parser.add_argument("--max", type=int, default=3000, help="tope de perfumes a procesar")
    args = parser.parse_args()

    global BASE_URL
    import os
    BASE_URL = args.base_url or os.environ.get("FRAGRANTICA_BASE_URL", BASE_URL)

    salida = Path(args.salida)
    ids_previos = cargar_ids_previos(Path(args.desde)) if args.incremental else set()
    log.info("IDs ya scrapeados: %d", len(ids_previos))

    if args.familia:
        url_listado = f"{BASE_URL}/grupos-olfativos/{args.familia}.html"
    elif args.letra:
        url_listado = f"{BASE_URL}/disenadores-por-letra/{args.letra.upper()}.html"
    else:
        parser.error("Indicá --familia o --letra para definir el recorrido.")

    perfumes, fallidos, lote = [], [], 1

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent="SillageBot/1.0 (mantenimiento de catálogo; contacto: dev@sillage.app)"
        )

        urls = extraer_listado(page, url_listado)
        log.info("URLs encontradas: %d", len(urls))

        for url in urls[: args.max]:
            pid = slug_id(url)
            if pid in ids_previos:
                continue
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                dormir()
                ficha = parsear_ficha(page.content(), url)
                if not ficha["nombre"] or not ficha["marca"]:
                    raise ValueError("ficha incompleta (nombre/marca)")
                perfumes.append(ficha)
            except Exception as e:  # noqa: BLE001 — log y seguir
                log.error("FALLO %s: %s", url, e)
                fallidos.append(url)
                continue

            if len(perfumes) >= TAMANO_LOTE:
                exportar_lote(perfumes, salida, lote)
                perfumes, lote = [], lote + 1

        browser.close()

    if perfumes:
        exportar_lote(perfumes, salida, lote)

    if fallidos:
        with open(salida / "no_procesados.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(fallidos))
        log.warning("Perfumes no procesados: %d (ver no_procesados.txt)", len(fallidos))

    log.info("Listo.")


if __name__ == "__main__":
    main()
