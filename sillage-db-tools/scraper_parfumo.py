#!/usr/bin/env python3
"""
scraper_parfumo.py — Fuente 2 (fallback y complemento).

Si Fragrantica bloquea o los datos están incompletos, Parfumo cubre bien
perfumes europeos y de nicho. Mismo esquema de salida que
scraper_fragrantica.py, así normalizer.py y uploader.py funcionan igual.

Uso:
  python scraper_parfumo.py --marca "Dior" --salida salida_parfumo/
  python scraper_parfumo.py --completar salida/  (rellena fichas incompletas)
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

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.parfumo.com"
DELAY_MIN, DELAY_MAX = 2.0, 4.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler("errores_parfumo.log"), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("parfumo")

session = requests.Session()
session.headers.update({
    "User-Agent": "SillageBot/1.0 (mantenimiento de catálogo; contacto: dev@sillage.app)",
    "Accept-Language": "es,en;q=0.8",
})


def dormir():
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


def obtener(url: str) -> BeautifulSoup | None:
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
        dormir()
        return BeautifulSoup(r.text, "html.parser")
    except requests.RequestException as e:
        log.error("FALLO %s: %s", url, e)
        return None


def parsear_ficha(soup: BeautifulSoup, url: str) -> dict:
    nombre = soup.select_one("h1[itemprop='name'], h1")
    marca = soup.select_one("span[itemprop='brand'], .p_brand_name a")

    def notas(clase):
        return [
            n.get_text(strip=True)
            for n in soup.select(f".notes_list .{clase} .nowrap, .pyramid_block.{clase} span.nowrap")
        ][:15]

    rating_el = soup.select_one("span[itemprop='ratingValue']")
    votos_el = soup.select_one("span[itemprop='ratingCount']")

    anio = None
    m = re.search(r"\b(19|20)\d{2}\b", soup.get_text()[:2000])
    if m:
        anio = int(m.group(0))

    genero = "U"
    cuerpo = soup.get_text()[:3000].lower()
    if "for men" in cuerpo or "masculin" in cuerpo:
        genero = "M"
    elif "for women" in cuerpo or "féminin" in cuerpo:
        genero = "F"

    imagen = soup.select_one("img[itemprop='image'], .p_image img")

    return {
        "id": re.sub(r"\W+", "-", url.split("/")[-1]).lower(),
        "nombre": nombre.get_text(strip=True) if nombre else None,
        "marca": marca.get_text(strip=True) if marca else None,
        "anio": anio,
        "genero": genero,
        "concentracion": None,
        "familia_principal": None,
        "familias_secundarias": [],
        "notas_salida": notas("top"),
        "notas_corazon": notas("heart"),
        "notas_fondo": notas("base"),
        "descriptores": [],
        "rating": float(rating_el.get_text(strip=True)) if rating_el else None,
        "votos": int(re.sub(r"\D", "", votos_el.get_text())) if votos_el else 0,
        "discontinuado": "discontinued" in cuerpo,
        "imagen_url": imagen.get("src") if imagen else None,
        "url_fragrantica": None,
        "url_parfumo": url,
        "scrapeado_at": datetime.now(timezone.utc).isoformat(),
    }


def scrapear_marca(marca: str, maximo: int) -> list[dict]:
    soup = obtener(f"{BASE_URL}/Brands/{marca.replace(' ', '_')}")
    if not soup:
        return []
    urls = [
        (u if u.startswith("http") else BASE_URL + u)
        for u in {a.get("href", "") for a in soup.select("a[href*='/Perfumes/']")}
        if "/Perfumes/" in u
    ]
    fichas = []
    for url in urls[:maximo]:
        s = obtener(url)
        if not s:
            continue
        ficha = parsear_ficha(s, url)
        if ficha["nombre"] and ficha["marca"]:
            fichas.append(ficha)
    return fichas


def completar(directorio: Path):
    """Rellena con Parfumo las fichas de Fragrantica que quedaron incompletas."""
    for archivo in directorio.glob("perfumes_*.json"):
        with open(archivo, encoding="utf-8") as f:
            perfumes = json.load(f)
        cambiados = 0
        for p in perfumes:
            if p.get("notas_fondo") and p.get("rating") is not None:
                continue
            consulta = f"{p['marca']} {p['nombre']}".replace(" ", "+")
            soup = obtener(f"{BASE_URL}/s_perfumes_x.php?in=1&filter={consulta}")
            if not soup:
                continue
            enlace = soup.select_one("a[href*='/Perfumes/']")
            if not enlace:
                continue
            url = enlace["href"]
            url = url if url.startswith("http") else BASE_URL + url
            s = obtener(url)
            if not s:
                continue
            ficha = parsear_ficha(s, url)
            for campo in ("notas_salida", "notas_corazon", "notas_fondo", "rating", "votos", "anio"):
                if not p.get(campo) and ficha.get(campo):
                    p[campo] = ficha[campo]
                    cambiados += 1
        with open(archivo, "w", encoding="utf-8") as f:
            json.dump(perfumes, f, ensure_ascii=False, indent=2)
        log.info("%s: %d campos completados", archivo.name, cambiados)


def main():
    parser = argparse.ArgumentParser(description="Scraper de Parfumo (fuente 2)")
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--marca", help="scrapear todos los perfumes de una marca")
    grupo.add_argument("--completar", help="directorio de JSON de Fragrantica a completar")
    parser.add_argument("--salida", default="salida_parfumo")
    parser.add_argument("--max", type=int, default=200)
    args = parser.parse_args()

    if args.completar:
        completar(Path(args.completar))
        return

    fichas = scrapear_marca(args.marca, args.max)
    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    archivo = salida / f"perfumes_{args.marca.replace(' ', '_').lower()}.json"
    with open(archivo, "w", encoding="utf-8") as f:
        json.dump(fichas, f, ensure_ascii=False, indent=2)
    log.info("Exportado: %s (%d perfumes)", archivo, len(fichas))


if __name__ == "__main__":
    main()
