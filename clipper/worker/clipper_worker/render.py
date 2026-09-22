"""Render de un clip: recorte, reencuadre, subtítulos quemados, loudness y tamaño máximo."""
from __future__ import annotations

import subprocess
from pathlib import Path

import cv2
import numpy as np

from . import framing
from .config import config
from .errors import UserError
from .log import get_logger
from .media import cut_segment, fps_of, has_audio, loudnorm_filter, measure_loudness, probe
from .subtitles import apply_edits, build_ass, build_cues, write_ass

log = get_logger(__name__)

OUT_W, OUT_H = config.OUTPUT_W, config.OUTPUT_H
AUDIO_BPS = 128_000


def speaker_change_times(words: list[dict], start: float, end: float) -> list[float]:
    out: list[float] = []
    prev = None
    for w in words:
        if w["e"] <= start or w["s"] >= end:
            continue
        spk = w.get("spk")
        if spk is None:
            continue
        if prev is not None and spk != prev:
            out.append(max(0.0, w["s"] - start))
        prev = spk
    return out


def video_bitrate_budget(duration_s: float) -> int:
    cap_bytes = config.MAX_OUTPUT_MB * 1000 * 1000
    total_bps = (cap_bytes * 8 * 0.92) / max(1.0, duration_s)
    video = int(total_bps - AUDIO_BPS)
    return max(1_200_000, min(10_000_000, video))


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
) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    if end - start < 3:
        raise UserError("El clip es demasiado corto (menos de 3 segundos).")
    info = probe(source)
    fps = fps_of(info)

    if progress:
        progress("Cortando el segmento")
    segment = cut_segment(source, workdir / "segment.mp4", start, end, fps=fps)
    seg_info = probe(segment)
    audio = has_audio(seg_info)
    duration = end - start

    if progress:
        progress("Preparando subtítulos")
    cues = apply_edits(build_cues(words, start, end, preset), subtitle_edits)
    ass_path = write_ass(workdir / "subs.ass", build_ass(cues, preset, title, duration))

    if progress:
        progress("Detectando rostros")
    analysis = framing.analyze(segment)
    plan = framing.build_plan(analysis, preset, speaker_change_times(words, start, end))
    log.info("encuadre: modo=%s tracks=%d muestras=%d", plan.mode, len(analysis.tracks), len(plan.keys))

    measured = measure_loudness(segment) if audio else None
    out = workdir / "clip.mp4"
    if progress:
        progress("Codificando")
    _encode(segment, plan, ass_path, out, fps=plan.fps, audio=audio, loudnorm=loudnorm_filter(measured), duration=duration, progress=progress)

    cap_bytes = config.MAX_OUTPUT_MB * 1000 * 1000
    if out.stat().st_size > cap_bytes:
        if progress:
            progress("Ajustando tamaño (máximo %d MB)" % config.MAX_OUTPUT_MB)
        out = _shrink(out, workdir / "clip_small.mp4", duration)
    return out


def _encode(segment: Path, plan: framing.Plan, ass_path: Path, out: Path, *, fps: float, audio: bool,
            loudnorm: str, duration: float, progress=None) -> None:
    vbps = video_bitrate_budget(duration)
    ass_arg = str(ass_path).replace("\\", "/").replace(":", "\\:")
    filters = [f"[0:v]ass={ass_arg}[v]"]
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-nostats",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{OUT_W}x{OUT_H}", "-framerate", f"{fps:.3f}", "-i", "pipe:0",
    ]
    if audio:
        cmd += ["-i", str(segment)]
        filters.append(f"[1:a]{loudnorm},aresample=48000[a]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[v]"]
    if audio:
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

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    cap = cv2.VideoCapture(str(segment))
    if not cap.isOpened():
        proc.kill()
        raise RuntimeError("OpenCV no pudo abrir el segmento para renderizar")
    total = plan.n_frames or int(duration * fps)
    idx = 0
    last_pct = -1
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = idx / fps
            canvas = _compose(frame, plan.rects_at(t), plan.mode)
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
