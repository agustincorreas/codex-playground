#!/usr/bin/env python3
"""
uploader.py — Tercera etapa: carga el JSON normalizado a Firestore.

  - Batch writes de a 500 documentos (límite de Firestore).
  - Upsert por ID estable: actualiza documentos existentes sin duplicar.
  - Reporta cuántos documentos se crearon vs actualizaron.

Requiere credenciales de servicio:
  export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json

Uso:
  python uploader.py --entrada normalizado/
  python uploader.py --entrada normalizado/ --dry-run
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("uploader")

TAMANO_BATCH = 500


def cargar_perfumes(entrada: Path) -> list[dict]:
    perfumes = []
    for archivo in sorted(entrada.glob("perfumes_*.json")):
        with open(archivo, encoding="utf-8") as f:
            perfumes.extend(json.load(f))
    # de-dup por id (el último gana: asume re-scrapeos más recientes al final)
    por_id = {p["id"]: p for p in perfumes}
    return list(por_id.values())


def ids_existentes(db, ids: list[str]) -> set[str]:
    """Consulta qué IDs ya existen, en tandas de 300 referencias."""
    existentes = set()
    coleccion = db.collection("perfumes")
    for i in range(0, len(ids), 300):
        refs = [coleccion.document(pid) for pid in ids[i : i + 300]]
        for snap in db.get_all(refs):
            if snap.exists:
                existentes.add(snap.id)
    return existentes


def main():
    parser = argparse.ArgumentParser(description="Carga de perfumes a Firestore")
    parser.add_argument("--entrada", default="normalizado")
    parser.add_argument("--dry-run", action="store_true", help="no escribe, solo reporta")
    args = parser.parse_args()

    perfumes = cargar_perfumes(Path(args.entrada))
    log.info("Perfumes a procesar: %d", len(perfumes))
    if not perfumes:
        return

    firebase_admin.initialize_app(credentials.ApplicationDefault())
    db = firestore.client()

    existentes = ids_existentes(db, [p["id"] for p in perfumes])
    log.info("Ya existentes en Firestore: %d", len(existentes))

    if args.dry_run:
        log.info("[dry-run] Se crearían %d y actualizarían %d documentos.",
                 len(perfumes) - len(existentes), len(existentes))
        return

    ahora = datetime.now(timezone.utc)
    creados = actualizados = 0
    batch = db.batch()
    en_batch = 0

    for p in perfumes:
        ref = db.collection("perfumes").document(p["id"])
        doc = {**p, "actualizado_at": ahora}
        if p["id"] in existentes:
            actualizados += 1
        else:
            doc["creado_at"] = ahora
            creados += 1
        batch.set(ref, doc, merge=True)
        en_batch += 1
        if en_batch >= TAMANO_BATCH:
            batch.commit()
            log.info("Batch confirmado (%d docs)...", en_batch)
            batch = db.batch()
            en_batch = 0

    if en_batch:
        batch.commit()

    log.info("Listo. Creados: %d · Actualizados: %d", creados, actualizados)


if __name__ == "__main__":
    main()
