"""Render de un clip: recorte, jump cuts, reencuadre, subtítulos quemados,
música de fondo, barra de progreso, loudness y tamaño máximo."""
from __future__ import annotations

import random
import subprocess
from pathlib import Path

import cv2
import numpy as np

from . import framing, storage
from .config import config
from .errors import UserError
from .log import get_logger
from .media import (
    audio_envelope, cut_points, cut_ranges, cut_segment, extract_audio, fps_of, has_audio,
    keep_ranges_from_words, loudnorm_filter, measure_loudness, mix_music, probe, remap_time,
)
from .subtitles import apply_edits, build_ass, build_cues, cue_key, write_ass

log = get_logger(__name__)

OUT_W, OUT_H = config.OUTPUT_W, config.OUTPUT_H
AUDIO_BPS = 128_000
FLASH_S = 0.12


def speaker_change_times(words: list[dict]) -> list[float]:
    """Instantes (tiempos de las palabras dadas) en que cambia el hablante."""
    out: list[float] = []
    prev = None
    for w in words:
        spk = w.get("spk")
        if spk is None:
            continue
        if prev is not None and spk != prev:
            out.append(max(0.0, w["s"]))
        prev = spk
    return out


def video_bitrate_budget(duration_s: float) -> int:
    cap_bytes = config.MAX_OUTPUT_MB * 1000 * 1000
    total_bps = (cap_bytes * 8 * 0.92) / max(1.0, duration_s)
    video = int(total_bps - AUDIO_BPS)
    return max(1_200_000, min(10_000_000, video))


def relative_words(words: list[dict], start: float, end: float) -> list[dict]:
    """Palabras del rango con tiempos relativos al clip y clave estable `k`."""
    out = []
    for w in words:
        if w["e"] <= start or w["s"] >= end:
            continue
        out.append({
            "t": w["t"], "spk": w.get("spk"), "k": cue_key(w["s"]),
            "s": max(0.0, w["s"] - start), "e": min(end, w["e"]) - start,
        })
    return out


def pick_music(preset: dict, workdir: Path) -> Path | None:
    music = preset.get("music") or {}
    if not music.get("enabled"):
        return None
    track = music.get("track") or "random"
    try:
        files = storage.list_files("music")
    except Exception as e:  # noqa: BLE001
        log.warning("no se pudo listar la música: %s", e)
        return None
    names = [f["name"] for f in files if f["name"].lower().endswith((".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"))]
    if not names:
        log.warning("música activada pero la biblioteca (music/) está vacía; se renderiza sin música")
        return None
    chosen = track.split("/", 1)[1] if track.startswith("music/") else track
    if chosen not in names:
        chosen = random.choice(names)
    local = storage.download_file(f"music/{chosen}", workdir / "music" / chosen)
    return local


def render_clip(
    *,
    source: Path,
    start: float,
    end: float,
    words: list[dict],
    preset: dict,
    title: str | None,
    subtitle_edits: dict | None,
    workdir: Path,
    progress=None,
    remove_ranges: list | None = None,
) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    if end - start < 3:
        raise UserError("El clip es demasiado corto (menos de 3 segundos).")
    info = probe(source)
    fps = fps_of(info)

    # 1. Corte exacto del rango
    if progress:
        progress("Cortando el segmento")
    segment = cut_segment(source, workdir / "segment.mp4", start, end, fps=fps)
    audio = has_audio(probe(segment))
    duration = end - start
    rel_words = relative_words(words, start, end)

    # 2. Edición: aire muerto en los bordes, falsos comienzos/repeticiones y pausas largas
    hard_cuts: list[float] = []
    cuts_cfg = preset.get("cuts") or {}
    forced = [(max(0.0, a - start), min(duration, b - start)) for a, b in (remove_ranges or []) if b > start and a < end]
    if rel_words and audio:
        min_pause = float(cuts_cfg.get("min_pause_s", 0.7)) if cuts_cfg.get("remove_silences", True) else 1e9
        ranges = keep_ranges_from_words(
            rel_words, duration, min_pause, float(cuts_cfg.get("keep_pause_s", 0.25)),
            envelope=audio_envelope(segment), forced_removals=forced, trim_edges=True,
        )
        removed = duration - sum(b - a for a, b in ranges)
        if len(ranges) > 1 and removed > 0.3:
            if progress:
                progress(f"Recortando {len(ranges) - 1} pausas ({removed:.1f} s)")
            segment = cut_ranges(segment, workdir / "segment_cut.mp4", ranges, fps=fps, audio=audio)
            for w in rel_words:
                w["s"] = remap_time(w["s"], ranges)
                w["e"] = max(w["s"] + 0.05, remap_time(w["e"], ranges))
            hard_cuts = cut_points(ranges)
            duration = sum(b - a for a, b in ranges)

    # 3. Encuadre
    if progress:
        progress("Detectando rostros")
    analysis = framing.analyze(segment)
    plan = framing.build_plan(analysis, preset, speaker_change_times(rel_words), hard_cuts)
    log.info("encuadre: modo=%s tracks=%d muestras=%d cortes=%d", plan.mode, len(analysis.tracks), len(plan.keys), len(plan.cuts))

    # 4. Subtítulos (y título, salvo que vaya por detrás de la persona)
    if progress:
        progress("Preparando subtítulos")
    cues = apply_edits(build_cues(rel_words, 0.0, duration, preset), subtitle_edits)
    anchors = framing.face_anchors(analysis, plan, preset) if preset["subtitles"].get("position") == "follow" else None
    title_behind = bool(preset.get("title", {}).get("show") and preset["title"].get("behind_subject") and title)
    ass_path = write_ass(workdir / "subs.ass", build_ass(cues, preset, title, duration, anchors=anchors, skip_title=title_behind))

    # 5. Audio: música de fondo (opcional) y medición de loudness
    audio_path: Path | None = None
    if audio:
        audio_path = extract_audio(segment, workdir / "voice.wav", mono16k=False)
        music = pick_music(preset, workdir)
        if music is not None:
            if progress:
                progress("Mezclando música")
            m = preset["music"]
            audio_path = mix_music(
                audio_path, music, workdir / "mix.wav", duration=duration,
                volume_db=float(m.get("volume_db", -20)), duck=bool(m.get("duck", True)),
                fade_out_s=float(m.get("fade_out_s", 2)),
            )
    measured = measure_loudness(audio_path) if audio_path else None

    # 6. Codificación
    out = workdir / "clip.mp4"
    if progress:
        progress("Codificando")
    _encode(segment, plan, ass_path, out, fps=plan.fps, audio_path=audio_path,
            loudnorm=loudnorm_filter(measured), duration=duration, preset=preset, progress=progress,
            title=title if title_behind else None)

    cap_bytes = config.MAX_OUTPUT_MB * 1000 * 1000
    if out.stat().st_size > cap_bytes:
        if progress:
            progress("Ajustando tamaño (máximo %d MB)" % config.MAX_OUTPUT_MB)
        out = _shrink(out, workdir / "clip_small.mp4", duration)
    return out


def _encode(segment: Path, plan: framing.Plan, ass_path: Path, out: Path, *, fps: float, audio_path: Path | None,
            loudnorm: str, duration: float, preset: dict, progress=None, title: str | None = None) -> None:
    vbps = video_bitrate_budget(duration)
    ass_arg = str(ass_path).replace("\\", "/").replace(":", "\\:")
    filters = [f"[0:v]ass={ass_arg}[v]"]
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-nostats",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{OUT_W}x{OUT_H}", "-framerate", f"{fps:.3f}", "-i", "pipe:0",
    ]
    if audio_path:
        cmd += ["-i", str(audio_path)]
        filters.append(f"[1:a]{loudnorm},aresample=48000[a]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[v]"]
    if audio_path:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000"]
    cmd += [
        "-c:v", "libx264", "-preset", config.X264_PRESET, "-crf", "20",
        "-maxrate", str(vbps), "-bufsize", str(vbps * 2),
        "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
        "-r", f"{fps:.3f}", "-movflags", "+faststart", "-shortest",
    ]
    if config.FFMPEG_THREADS:
        cmd += ["-threads", str(config.FFMPEG_THREADS)]
    cmd += [str(out)]

    pb = preset.get("progress_bar") or {}
    pb_enabled = bool(pb.get("enabled")) if isinstance(pb, dict) else bool(pb)
    pb_color = _bgr(pb.get("color", "#FFFFFF")) if isinstance(pb, dict) else (255, 255, 255)
    pb_h = int(pb.get("height", 10)) if isinstance(pb, dict) else 10
    flash = preset.get("transitions") == "flash"
    cuts = sorted(plan.cuts)
    white = np.full((OUT_H, OUT_W, 3), 255, dtype=np.uint8)

    # Título por detrás de la persona: capa de título + segmentación por cuadro.
    title_layer = segmenter = None
    title_end = 0.0
    if title:
        from .segmentation import PersonSegmenter
        from .titlecard import composite_behind, render_title
        ttl = preset.get("title", {})
        title_layer = render_title(title, preset)
        segmenter = PersonSegmenter()
        title_end = duration if ttl.get("permanent") else min(duration, float(ttl.get("duration_s", 3)))

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    cap = cv2.VideoCapture(str(segment))
    if not cap.isOpened():
        proc.kill()
        raise RuntimeError("OpenCV no pudo abrir el segmento para renderizar")
    total = plan.n_frames or int(duration * fps)
    idx = 0
    last_pct = -1
    cut_i = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = idx / fps
            canvas = _compose(frame, plan.rects_at(t), plan.mode)
            if flash and cuts:
                while cut_i + 1 < len(cuts) and cuts[cut_i + 1] <= t:
                    cut_i += 1
                dt = t - cuts[cut_i]
                if 0 <= dt < FLASH_S:
                    a = 0.75 * (1.0 - dt / FLASH_S)
                    canvas = cv2.addWeighted(canvas, 1.0 - a, white, a, 0)
            if title_layer is not None and t < title_end:
                fade = min(1.0, t / 0.3) * (min(1.0, (title_end - t) / 0.3) if title_end < duration else 1.0)
                canvas = composite_behind(canvas, title_layer, segmenter.mask(canvas), alpha=fade)
            if pb_enabled and total:
                _draw_progress(canvas, idx / max(1, total - 1), pb_color, pb_h)
            proc.stdin.write(canvas.tobytes())
            idx += 1
            if progress and total:
                pct = int(idx * 100 / total)
                if pct != last_pct and pct % 10 == 0:
                    last_pct = pct
                    progress(f"Codificando {pct}%")
    except BrokenPipeError:
        pass
    finally:
        cap.release()
        try:
            proc.stdin.close()
        except Exception:
            pass
    err = proc.stderr.read() if proc.stderr else b""
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg falló al codificar:\n" + (err or b"").decode(errors="replace")[-2000:])
    if idx == 0:
        raise RuntimeError("No se leyó ningún cuadro del segmento")


def _bgr(hex_color: str) -> tuple[int, int, int]:
    c = (hex_color or "#FFFFFF").lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    return int(c[4:6], 16), int(c[2:4], 16), int(c[0:2], 16)


def _draw_progress(canvas: np.ndarray, frac: float, color: tuple[int, int, int], height: int) -> None:
    h = max(2, min(40, height))
    y0 = OUT_H - h
    track = canvas[y0:OUT_H, :, :]
    track[:] = (track * 0.55).astype(np.uint8)
    x1 = int(round(max(0.0, min(1.0, frac)) * OUT_W))
    if x1 > 0:
        canvas[y0:OUT_H, :x1, :] = color


def _compose(frame: np.ndarray, rects: list[tuple[int, int, int, int]], mode: str) -> np.ndarray:
    if mode == "split" and len(rects) == 2:
        half = OUT_H // 2
        panels = []
        for (x, y, w, h) in rects:
            crop = frame[y:y + h, x:x + w]
            panels.append(cv2.resize(crop, (OUT_W, half), interpolation=cv2.INTER_AREA))
        return np.vstack(panels)
    x, y, w, h = rects[0]
    crop = frame[y:y + h, x:x + w]
    interp = cv2.INTER_AREA if w > OUT_W else cv2.INTER_LINEAR
    return cv2.resize(crop, (OUT_W, OUT_H), interpolation=interp)


def _shrink(src: Path, dst: Path, duration: float) -> Path:
    """Segunda pasada con bitrate fijo si el archivo superó el máximo."""
    vbps = int(video_bitrate_budget(duration) * 0.85)
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(src),
            "-c:v", "libx264", "-preset", config.X264_PRESET, "-b:v", str(vbps),
            "-maxrate", str(vbps), "-bufsize", str(vbps * 2), "-pix_fmt", "yuv420p",
            "-c:a", "copy", "-movflags", "+faststart", str(dst),
        ],
        check=True, capture_output=True,
    )
    return dst
