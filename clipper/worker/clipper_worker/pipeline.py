"""Trabajos del worker: procesar video, renderizar clip, guardar en Drive."""
from __future__ import annotations

import shutil
from pathlib import Path

from . import db, drive, sources, storage
from .config import config
from .corrections import correct_transcript, drop_words_in_ranges
from .errors import UserError
from .log import get_logger
from .media import duration_of, extract_audio, make_preview, make_thumbnail
from .presets import load_preset
from .render import render_clip
from .select_moments import select_moments
from .sentences import build_sentences
from .subtitles import build_cues
from .transcribe import transcribe

log = get_logger(__name__)


def _workdir(name: str) -> Path:
    d = config.WORK_DIR / "work" / name
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    return d


def process_video(job: dict) -> None:
    video_id = str(job["video_id"])
    video = db.get_video(video_id)
    if not video:
        raise UserError("El video ya no existe.")

    def progress(detail: str):
        db.update_video(video_id, status_detail=detail)

    # 1. Descarga
    db.set_video_status(video_id, "downloading", "Descargando")
    source, title = sources.acquire(video, progress)
    duration = duration_of(source)
    db.update_video(video_id, title=title or video.get("title") or source.name, duration_s=duration, status_detail=None)
    if duration > 6 * 3600:
        raise UserError("El video dura más de 6 horas; recortalo antes de procesarlo.")

    # 2. Transcripción
    db.set_video_status(video_id, "transcribing", "Extrayendo audio")
    work = _workdir(video_id)
    audio = extract_audio(source, work / "audio.mp3")
    db.set_video_status(video_id, "transcribing", f"Transcribiendo con {config.TRANSCRIBE_PROVIDER}")
    transcript = transcribe(audio)
    words = transcript["words"]
    db.set_video_status(video_id, "transcribing", "Revisando nombres y términos")
    correction = correct_transcript(words, video.get("topics"))
    transcript["corrections"] = correction.get("replacements", [])
    transcript["remove_ranges"] = correction.get("remove_ranges", [])   # falsos comienzos, repeticiones
    transcript["words_raw"] = list(words)
    words = drop_words_in_ranges(words, transcript["remove_ranges"])
    transcript["words"] = words
    sentences = build_sentences(words)
    db.update_video(video_id, transcript=transcript, sentences=sentences, language=transcript.get("language"))

    # 3. Selección de momentos
    db.set_video_status(video_id, "selecting", "Eligiendo momentos con Claude")
    preset = load_preset(video.get("preset_id"))
    candidates = select_moments(
        sentences, words,
        min_s=float(video.get("min_duration_s") or 60),
        max_s=float(video.get("max_duration_s") or 120),
        topics=video.get("topics"),
        video_duration=duration,
    )
    if not candidates:
        raise UserError(
            "Claude no encontró momentos que cumplan la duración pedida. Probá con otro rango de duración o sin temas."
        )
    for c in candidates:
        c["subtitles"] = build_cues(words, c["start_s"], c["end_s"], preset)
    clips = db.replace_clips(video_id, candidates)
    db.set_video_status(video_id, "ready", f"Generando vistas previas 0/{len(clips)}")

    # 4. Vistas previas y miniaturas (la UI ya muestra los candidatos mientras tanto)
    pad = float(config.PREVIEW_PAD_S)
    for i, clip in enumerate(clips):
        cid = str(clip["id"])
        try:
            p_start = max(0.0, float(clip["start_s"]) - pad)
            p_end = min(duration, float(clip["end_s"]) + pad)
            thumb = make_thumbnail(source, work / f"{cid}.jpg", float(clip["start_s"]) + 1.0)
            storage.upload_file(thumb, f"thumbs/{cid}.jpg", "image/jpeg")
            preview = make_preview(source, work / f"{cid}.mp4", p_start, p_end)
            storage.upload_file(preview, f"previews/{cid}.mp4", "video/mp4")
            db.update_clip(cid, thumb_path=f"thumbs/{cid}.jpg", preview_path=f"previews/{cid}.mp4", preview_offset_s=p_start)
            preview.unlink(missing_ok=True)
            thumb.unlink(missing_ok=True)
        except Exception as e:  # una vista previa fallida no frena el resto
            log.exception("vista previa de %s falló: %s", cid, e)
        db.update_video(video_id, status_detail=f"Generando vistas previas {i + 1}/{len(clips)}")
    db.update_video(video_id, status_detail=None)
    shutil.rmtree(work, ignore_errors=True)
    sources.prune_cache(keep_video_id=video_id)


def render_clip_job(job: dict) -> None:
    clip_id = str(job["clip_id"])
    clip = db.get_clip(clip_id)
    if not clip:
        raise UserError("El clip ya no existe.")
    video = db.get_video(str(clip["video_id"]))
    if not video or not video.get("transcript"):
        raise UserError("El video original ya no tiene transcripción.")

    def progress(detail: str):
        db.update_clip(clip_id, status_detail=detail)

    db.update_clip(clip_id, status="rendering", status_detail="Preparando", error=None)
    preset = load_preset(clip.get("preset_id") or video.get("preset_id"))
    source, _ = sources.acquire(video, lambda d: progress(f"Recuperando el video original: {d}"))
    work = _workdir(f"clip-{clip_id}")
    out = render_clip(
        source=source,
        start=float(clip["start_s"]),
        end=float(clip["end_s"]),
        words=video["transcript"]["words"],
        remove_ranges=video["transcript"].get("remove_ranges") or [],
        preset=preset,
        title=clip.get("title") or None,
        subtitle_edits=clip.get("subtitle_edits") or {},
        workdir=work,
        progress=progress,
    )
    progress("Subiendo")
    path = f"renders/{clip_id}.mp4"
    storage.upload_file(out, path, "video/mp4")
    db.update_clip(
        clip_id, status="ready", status_detail=None, render_path=path, render_bytes=out.stat().st_size,
        drive_file_id=None, drive_url=None,
    )
    shutil.rmtree(work, ignore_errors=True)


def save_to_drive_job(job: dict) -> None:
    clip_id = str(job["clip_id"])
    clip = db.get_clip(clip_id)
    if not clip or not clip.get("render_path"):
        raise UserError("El clip no está renderizado todavía.")
    video = db.get_video(str(clip["video_id"])) or {}
    folder = db.get_setting("drive_folder_id")
    work = _workdir(f"drive-{clip_id}")
    local = storage.download_file(clip["render_path"], work / "clip.mp4")
    base = (clip.get("title") or video.get("title") or "clip").strip()[:80]
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in base).strip() or "clip"
    db.update_clip(clip_id, status_detail="Guardando en Drive")
    result = drive.upload(local, f"{safe}.mp4", folder if isinstance(folder, str) and folder else None)
    db.update_clip(clip_id, status_detail=None, drive_file_id=result.get("id"), drive_url=result.get("webViewLink"))
    shutil.rmtree(work, ignore_errors=True)
