"""Bucle principal del worker: toma trabajos de la cola en Postgres y los ejecuta."""
from __future__ import annotations

import sys
import time
import traceback

from . import db, pipeline
from .config import config
from .errors import RetryableError, UserError
from .log import get_logger
from .presets import ensure_builtin_presets

log = get_logger("worker")

MAX_ATTEMPTS = 3
HANDLERS = {
    "process_video": pipeline.process_video,
    "render_clip": pipeline.render_clip_job,
    "save_to_drive": pipeline.save_to_drive_job,
}


def _fail_entity(job: dict, message: str) -> None:
    if job.get("type") == "process_video" and job.get("video_id"):
        db.update_video(str(job["video_id"]), status="error", status_detail=None, error=message)
    elif job.get("clip_id"):
        if job.get("type") == "save_to_drive":
            db.update_clip(str(job["clip_id"]), status_detail=None, error=message)
        else:
            db.update_clip(str(job["clip_id"]), status="error", status_detail=None, error=message)


def handle(job: dict) -> None:
    handler = HANDLERS.get(job["type"])
    if handler is None:
        db.finish_job(str(job["id"]), error=f"tipo de trabajo desconocido: {job['type']}")
        return
    log.info("trabajo %s (%s) intento %s", job["id"], job["type"], job["attempts"])
    try:
        handler(job)
        db.finish_job(str(job["id"]))
        log.info("trabajo %s listo", job["id"])
    except UserError as e:
        log.warning("trabajo %s: %s", job["id"], e)
        db.finish_job(str(job["id"]), error=str(e))
        _fail_entity(job, str(e))
    except RetryableError as e:
        if job["attempts"] < MAX_ATTEMPTS:
            log.warning("trabajo %s se reintenta: %s", job["id"], e)
            db.finish_job(str(job["id"]), error=str(e), requeue=True)
        else:
            msg = f"Falló varias veces: {e}"
            db.finish_job(str(job["id"]), error=msg)
            _fail_entity(job, msg)
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        log.error("trabajo %s falló: %s\n%s", job["id"], e, tb)
        msg = f"Error inesperado: {type(e).__name__}: {str(e)[:400]}"
        db.finish_job(str(job["id"]), error=msg)
        _fail_entity(job, msg)


def main() -> int:
    missing = config.validate()
    if missing:
        log.error("faltan variables de entorno: %s", ", ".join(missing))
        return 1
    config.WORK_DIR.mkdir(parents=True, exist_ok=True)
    ensure_builtin_presets()
    n = db.requeue_stale_jobs()
    if n:
        log.info("%d trabajos re-encolados tras reinicio", n)
    log.info("worker listo (proveedor de transcripción: %s, modelo: %s)", config.TRANSCRIBE_PROVIDER, config.CLAUDE_MODEL)
    while True:
        try:
            job = db.claim_job()
        except Exception as e:  # noqa: BLE001
            log.error("no se pudo consultar la cola: %s", e)
            time.sleep(10)
            continue
        if job is None:
            time.sleep(config.POLL_INTERVAL_S)
            continue
        handle(job)


if __name__ == "__main__":
    sys.exit(main())
