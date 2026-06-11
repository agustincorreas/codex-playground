#!/usr/bin/env python3
"""
normalizer.py — Segunda etapa del pipeline.

Lee los JSON crudos del scraper y produce JSON normalizado listo para
uploader.py. Infiere los campos calculados del esquema de Firestore:

  ocasiones            <- reglas sobre descriptores + familia olfativa
  intensidad           <- descriptores y familia (1-5)
  longevidad_estimada  <- descriptores (1-5)
  sillage_estimado     <- descriptores (1-5)
  precio_rango         <- lista de marcas clasificadas manualmente
  popularidad_score    <- f(rating, votos)

Uso:
  python normalizer.py --entrada salida/ --salida normalizado/
"""

import argparse
import json
import logging
import math
import sys
import unicodedata
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("normalizer")


def sin_acentos(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto or "")
        if unicodedata.category(c) != "Mn"
    ).lower()


# ---------------------------------------------------------------------------
# Normalización de familia olfativa al vocabulario del motor de matching
# ---------------------------------------------------------------------------
FAMILIAS_CANONICAS = {
    "oriental": "Oriental", "amber": "Oriental", "ambar": "Oriental",
    "amaderado": "Amaderado", "woody": "Amaderado", "madera": "Amaderado",
    "floral": "Floral", "flores": "Floral",
    "fougere": "Fougère", "fougère": "Fougère",
    "chypre": "Chypre", "chipre": "Chypre",
    "citrico": "Cítrico", "citrus": "Cítrico", "hesperidado": "Cítrico",
    "acuatico": "Acuático", "aquatic": "Acuático", "marino": "Acuático",
    "gourmand": "Gourmand", "dulce": "Gourmand",
    "cuero": "Cuero", "leather": "Cuero",
    "aromatico": "Aromático", "aromatic": "Aromático",
    "especiado": "Especiado", "spicy": "Especiado",
    "musguoso": "Musguoso", "mossy": "Musguoso",
}


def normalizar_familia(cruda: str | None) -> str | None:
    if not cruda:
        return None
    clave = sin_acentos(cruda)
    for fragmento, canonica in FAMILIAS_CANONICAS.items():
        if fragmento in clave:
            return canonica
    return cruda.strip().capitalize()


# ---------------------------------------------------------------------------
# Reglas de inferencia de ocasiones (descriptores + familia)
# ---------------------------------------------------------------------------
REGLAS_OCASIONES = [
    # (condición sobre descriptores/familia, ocasiones que suma)
    (lambda d, f: "fresco" in d or "citrico" in d or f == "Cítrico", ["verano", "diario", "deporte"]),
    (lambda d, f: "acuatico" in d or f == "Acuático", ["verano", "deporte", "diario"]),
    (lambda d, f: "calido" in d or "especiado" in d or f in ("Oriental", "Especiado"), ["invierno", "noche"]),
    (lambda d, f: "dulce" in d or f == "Gourmand", ["noche", "invierno", "casual"]),
    (lambda d, f: "elegante" in d or "sofisticado" in d or f == "Chypre", ["formal", "trabajo"]),
    (lambda d, f: "limpio" in d or "jabonoso" in d, ["trabajo", "diario"]),
    (lambda d, f: "sensual" in d or "almizclado" in d, ["romántico", "noche"]),
    (lambda d, f: "suave" in d or "polvoroso" in d, ["diario", "trabajo"]),
    (lambda d, f: f in ("Fougère", "Aromático"), ["trabajo", "diario", "casual"]),
    (lambda d, f: f in ("Amaderado", "Cuero"), ["noche", "formal", "invierno"]),
    (lambda d, f: f == "Floral", ["diario", "romántico", "casual"]),
]

DESCRIPTORES_INTENSOS = {"intenso", "fuerte", "potente", "bestial", "animal", "opulento"}
DESCRIPTORES_SUAVES = {"suave", "ligero", "fresco", "limpio", "discreto", "delicado"}
DESCRIPTORES_DURADEROS = {"persistente", "duradero", "longevo", "eterno"}
DESCRIPTORES_PROYECCION = {"proyeccion", "estela", "expansivo", "sillage"}

FAMILIAS_PESADAS = {"Oriental", "Gourmand", "Cuero", "Especiado"}
FAMILIAS_LIGERAS = {"Cítrico", "Acuático", "Aromático"}


def inferir_ocasiones(descriptores: list[str], familia: str | None) -> list[str]:
    d = {sin_acentos(x) for x in descriptores}
    ocasiones: list[str] = []
    for condicion, resultado in REGLAS_OCASIONES:
        if condicion(d, familia):
            ocasiones.extend(resultado)
    # orden estable por frecuencia de aparición en las reglas
    conteo: dict[str, int] = {}
    for o in ocasiones:
        conteo[o] = conteo.get(o, 0) + 1
    return sorted(conteo, key=conteo.get, reverse=True)[:5] or ["diario"]


def inferir_intensidad(descriptores: list[str], familia: str | None) -> int:
    d = {sin_acentos(x) for x in descriptores}
    nivel = 3
    if d & DESCRIPTORES_INTENSOS:
        nivel += 1
    if d & DESCRIPTORES_SUAVES:
        nivel -= 1
    if familia in FAMILIAS_PESADAS:
        nivel += 1
    if familia in FAMILIAS_LIGERAS:
        nivel -= 1
    return max(1, min(5, nivel))


def inferir_longevidad(descriptores: list[str], familia: str | None) -> int:
    d = {sin_acentos(x) for x in descriptores}
    nivel = 3
    if d & DESCRIPTORES_DURADEROS:
        nivel += 1
    if familia in FAMILIAS_PESADAS:
        nivel += 1
    if familia in FAMILIAS_LIGERAS:
        nivel -= 1
    return max(1, min(5, nivel))


def inferir_sillage(descriptores: list[str], familia: str | None) -> int:
    d = {sin_acentos(x) for x in descriptores}
    nivel = 3
    if d & DESCRIPTORES_PROYECCION or d & DESCRIPTORES_INTENSOS:
        nivel += 1
    if d & DESCRIPTORES_SUAVES:
        nivel -= 1
    if familia in FAMILIAS_PESADAS:
        nivel += 1
    return max(1, min(5, nivel))


# ---------------------------------------------------------------------------
# Clasificación manual de marcas por rango de precio
# ---------------------------------------------------------------------------
MARCAS_PRECIO = {
    "accesible": [
        "Zara", "Avon", "Natura", "Cyzone", "Adidas", "Playboy", "AXE",
        "Antonio Banderas", "Shakira", "Benetton", "Mercadona", "Lattafa",
        "Armaf", "Al Haramain", "La Riviere", "Maison Alhambra",
    ],
    "medio": [
        "Calvin Klein", "Hugo Boss", "Carolina Herrera", "Paco Rabanne",
        "Rabanne", "Versace", "Davidoff", "Lacoste", "Azzaro", "Montblanc",
        "Issey Miyake", "Jean Paul Gaultier", "Burberry", "Moschino",
        "Cacharel", "Nautica", "Tommy Hilfiger", "Diesel", "Guess",
    ],
    "premium": [
        "Dior", "Chanel", "Yves Saint Laurent", "Giorgio Armani", "Armani",
        "Gucci", "Prada", "Hermès", "Hermes", "Givenchy", "Valentino",
        "Viktor&Rolf", "Viktor & Rolf", "Mugler", "Thierry Mugler",
        "Dolce&Gabbana", "Dolce & Gabbana", "Tom Ford", "Guerlain", "Lancôme",
        "Lancome", "Narciso Rodriguez", "Chloé", "Chloe",
    ],
    "nicho": [
        "Creed", "Maison Francis Kurkdjian", "Parfums de Marly", "Amouage",
        "Xerjoff", "Nishane", "Initio", "Byredo", "Le Labo", "Diptyque",
        "Penhaligon's", "Roja Parfums", "Frederic Malle", "Serge Lutens",
        "Memo", "Nasomatto", "Orto Parisi", "Mancera", "Montale", "BDK Parfums",
    ],
}

MARCA_A_RANGO = {
    sin_acentos(marca): rango
    for rango, marcas in MARCAS_PRECIO.items()
    for marca in marcas
}


def inferir_precio_rango(marca: str) -> str:
    return MARCA_A_RANGO.get(sin_acentos(marca), "medio")


# ---------------------------------------------------------------------------
# Popularidad: rating ponderado por volumen de votos (escala 0-100)
# ---------------------------------------------------------------------------
def popularidad_score(rating: float | None, votos: int) -> float:
    if not rating or votos <= 0:
        return 0.0
    # log10 satura: 10 votos ≈ 0.25, 1.000 ≈ 0.75, 10.000+ ≈ 1.0
    factor_votos = min(math.log10(votos + 1) / 4, 1.0)
    return round((rating / 10) * factor_votos * 100, 1)


# ---------------------------------------------------------------------------
def normalizar(perfume: dict) -> dict:
    familia = normalizar_familia(perfume.get("familia_principal"))
    descriptores = [sin_acentos(d) for d in perfume.get("descriptores", []) if d]

    return {
        **perfume,
        "familia_principal": familia,
        "familias_secundarias": [
            normalizar_familia(f) for f in perfume.get("familias_secundarias", []) if f
        ],
        "descriptores": descriptores,
        "rating": round(perfume.get("rating") or 0, 2),
        "votos": perfume.get("votos") or 0,
        "discontinuado": bool(perfume.get("discontinuado")),
        "ocasiones": inferir_ocasiones(descriptores, familia),
        "intensidad": inferir_intensidad(descriptores, familia),
        "longevidad_estimada": inferir_longevidad(descriptores, familia),
        "sillage_estimado": inferir_sillage(descriptores, familia),
        "precio_rango": inferir_precio_rango(perfume.get("marca", "")),
        "popularidad_score": popularidad_score(
            perfume.get("rating"), perfume.get("votos") or 0
        ),
        # Campos auxiliares para el autocompletado case-insensitive de la app.
        "nombre_lower": (perfume.get("nombre") or "").lower(),
        "marca_lower": (perfume.get("marca") or "").lower(),
    }


def main():
    parser = argparse.ArgumentParser(description="Normalizador de perfumes")
    parser.add_argument("--entrada", default="salida", help="directorio con JSON del scraper")
    parser.add_argument("--salida", default="normalizado", help="directorio de export")
    args = parser.parse_args()

    entrada, salida = Path(args.entrada), Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)

    total = 0
    for archivo in sorted(entrada.glob("perfumes_*.json")):
        with open(archivo, encoding="utf-8") as f:
            perfumes = json.load(f)
        normalizados = [normalizar(p) for p in perfumes if p.get("nombre") and p.get("marca")]
        destino = salida / archivo.name
        with open(destino, "w", encoding="utf-8") as f:
            json.dump(normalizados, f, ensure_ascii=False, indent=2)
        total += len(normalizados)
        log.info("%s -> %s (%d perfumes)", archivo.name, destino, len(normalizados))

    log.info("Total normalizado: %d", total)


if __name__ == "__main__":
    main()
