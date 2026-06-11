#!/usr/bin/env python3
"""
dataset_adapter.py — Fuente 3: datasets públicos (Kaggle / GitHub).

Adapta datasets comunitarios de fragancias (CSV o JSON ya scrapeados de
Fragrantica por la comunidad) al esquema crudo del pipeline, para que
normalizer.py y uploader.py funcionen sin cambios.

Uso:
  python dataset_adapter.py --csv fra_perfumes.csv --salida salida/
  python dataset_adapter.py --csv dataset.csv --mapeo mapeo.json --salida salida/

`--mapeo` permite ajustar nombres de columnas sin tocar código:
  { "nombre": "Perfume", "marca": "Brand", "notas_fondo": "Base Notes", ... }
"""

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Mapeo por defecto para los datasets de Fragrantica más difundidos en Kaggle.
MAPEO_DEFAULT = {
    "nombre": ["Perfume", "name", "title", "nombre"],
    "marca": ["Brand", "brand", "marca", "house"],
    "anio": ["Year", "year", "launch_year", "anio"],
    "genero": ["Gender", "gender", "for_gender", "genero"],
    "familia_principal": ["Main Accord", "main_accord", "family", "familia"],
    "notas_salida": ["Top", "Top Notes", "top_notes", "notas_salida"],
    "notas_corazon": ["Middle", "Heart Notes", "middle_notes", "notas_corazon"],
    "notas_fondo": ["Base", "Base Notes", "base_notes", "notas_fondo"],
    "descriptores": ["Accords", "main_accords", "accords", "descriptores"],
    "rating": ["Rating Value", "rating", "score"],
    "votos": ["Rating Count", "votes", "ratings_count", "votos"],
    "imagen_url": ["Image", "image_url", "img", "imagen_url"],
    "url_fragrantica": ["url", "URL", "link"],
}

TAMANO_LOTE = 500


def valor(fila: dict, claves: list[str]):
    for k in claves:
        if k in fila and str(fila[k]).strip() not in ("", "nan", "None"):
            return fila[k]
    return None


def como_lista(crudo) -> list[str]:
    if crudo is None:
        return []
    if isinstance(crudo, list):
        return [str(x).strip() for x in crudo if str(x).strip()]
    return [p.strip() for p in re.split(r"[,;|]", str(crudo)) if p.strip()]


def normalizar_genero(crudo) -> str:
    g = str(crudo or "").lower()
    if "women and men" in g or "unisex" in g or g == "u":
        return "U"
    if "women" in g or "mujer" in g or g == "f":
        return "F"
    if "men" in g or "hombre" in g or g == "m":
        return "M"
    return "U"


def adaptar(fila: dict, mapeo: dict) -> dict | None:
    nombre = valor(fila, mapeo["nombre"])
    marca = valor(fila, mapeo["marca"])
    if not nombre or not marca:
        return None

    rating_crudo = valor(fila, mapeo["rating"])
    try:
        rating = float(str(rating_crudo).replace(",", "."))
        if rating <= 5:  # datasets en escala 0-5: pasar a 0-10
            rating *= 2
    except (TypeError, ValueError):
        rating = None

    try:
        votos = int(re.sub(r"\D", "", str(valor(fila, mapeo["votos"]) or "")) or 0)
    except ValueError:
        votos = 0

    try:
        anio = int(float(valor(fila, mapeo["anio"]) or 0)) or None
    except (TypeError, ValueError):
        anio = None

    pid = re.sub(r"\W+", "-", f"{marca}-{nombre}").strip("-").lower()

    return {
        "id": pid,
        "nombre": str(nombre).strip(),
        "marca": str(marca).strip(),
        "anio": anio,
        "genero": normalizar_genero(valor(fila, mapeo["genero"])),
        "concentracion": None,
        "familia_principal": valor(fila, mapeo["familia_principal"]),
        "familias_secundarias": [],
        "notas_salida": como_lista(valor(fila, mapeo["notas_salida"])),
        "notas_corazon": como_lista(valor(fila, mapeo["notas_corazon"])),
        "notas_fondo": como_lista(valor(fila, mapeo["notas_fondo"])),
        "descriptores": [d.lower() for d in como_lista(valor(fila, mapeo["descriptores"]))],
        "rating": rating,
        "votos": votos,
        "discontinuado": False,
        "imagen_url": valor(fila, mapeo["imagen_url"]),
        "url_fragrantica": valor(fila, mapeo["url_fragrantica"]),
        "scrapeado_at": datetime.now(timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Adaptador de datasets públicos")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--mapeo", help="JSON con columnas custom")
    parser.add_argument("--salida", default="salida")
    args = parser.parse_args()

    mapeo = dict(MAPEO_DEFAULT)
    if args.mapeo:
        with open(args.mapeo, encoding="utf-8") as f:
            for clave, columna in json.load(f).items():
                mapeo[clave] = [columna] + mapeo.get(clave, [])

    perfumes = []
    with open(args.csv, encoding="utf-8", newline="") as f:
        for fila in csv.DictReader(f):
            adaptado = adaptar(fila, mapeo)
            if adaptado:
                perfumes.append(adaptado)

    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    for i in range(0, len(perfumes), TAMANO_LOTE):
        archivo = salida / f"perfumes_{i // TAMANO_LOTE + 1:04d}.json"
        with open(archivo, "w", encoding="utf-8") as f:
            json.dump(perfumes[i : i + TAMANO_LOTE], f, ensure_ascii=False, indent=2)
        print(f"Exportado {archivo} ({min(TAMANO_LOTE, len(perfumes) - i)} perfumes)")

    print(f"Total adaptado: {len(perfumes)}", file=sys.stderr)


if __name__ == "__main__":
    main()
