"""Utilidades ffmpeg/ffprobe."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .config import config
from .errors import UserError
from .log import get_logger

log = get_logger(__name__)


def run(cmd: list[str], *, timeout: int | None = None, capture: bool = True) -> subprocess.CompletedProcess:
    log.debug("run: %s", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=capture, text=True, timeout=timeout)
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-2000:]
        raise RuntimeError(f"Comando falló ({proc.returncode}): {cmd[0]}\n{tail}")
    return proc


def probe(path: Path) -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise UserError("No se pudo leer el archivo de video (¿está corrupto o no es un formato soportado?).")
    return json.loads(proc.stdout or "{}")


def duration_of(path: Path) -> float:
    info = probe(path)
    try:
        return float(info["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        for s in info.get("streams", []):
            if s.get("duration"):
                return float(s["duration"])
    raise UserError("No se pudo determinar la duración del video.")


def video_stream(info: dict) -> dict | None:
    for s in info.get("streams", []):
        if s.get("codec_type") == "video":
            return s
    return None


def fps_of(info: dict) -> float:
    s = video_stream(info) or {}
    for key in ("avg_frame_rate", "r_frame_rate"):
        val = s.get(key)
        if val and val != "0/0":
            num, _, den = val.partition("/")
            try:
                f = float(num) / float(den or 1)
                if 1 <= f <= 120:
                    return f
            except (ValueError, ZeroDivisionError):
                pass
    return 30.0


def has_audio(info: dict) -> bool:
    return any(s.get("codec_type") == "audio" for s in info.get("streams", []))


def extract_audio(src: Path, dst: Path, *, mono16k: bool = True) -> Path:
    """Extrae el audio a un archivo chico (mp3 mono 16 kHz) para transcribir."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn"]
    if mono16k:
        cmd += ["-ac", "1", "-ar", "16000", "-b:a", "48k"]
    else:
        cmd += ["-ac", "2", "-ar", "48000"]
    cmd += [str(dst)]
    run(cmd, timeout=3600)
    return dst


def cut_segment(src: Path, dst: Path, start: float, end: float, *, fps: float | None = None) -> Path:
    """Corta [start, end] re-codificando (corte exacto), CFR, audio AAC."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{max(0.0, start):.3f}", "-to", f"{end:.3f}", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-fps_mode", "cfr",
    ]
    if fps:
        cmd += ["-r", f"{fps:.3f}"]
    cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(dst)]
    run(cmd, timeout=3600)
    return dst


def make_preview(src: Path, dst: Path, start: float, end: float, height: int | None = None) -> Path:
    """Vista previa liviana (horizontal, baja resolución) para la interfaz."""
    height = height or config.PREVIEW_HEIGHT
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{max(0.0, start):.3f}", "-to", f"{end:.3f}", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", f"scale=-2:{height}",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p",
        "-fps_mode", "cfr", "-r", "24",
        "-c:a", "aac", "-b:a", "80k", "-ac", "1",
        "-movflags", "+faststart", str(dst),
    ], timeout=1800)
    return dst


def make_thumbnail(src: Path, dst: Path, t: float, width: int = 480) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(src),
        "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "4", str(dst),
    ], timeout=300)
    return dst


def measure_loudness(src: Path, target_i: float = -14.0, tp: float = -1.5, lra: float = 11.0) -> dict | None:
    """Primera pasada de loudnorm: devuelve las medidas para la segunda pasada."""
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "info", "-nostats", "-i", str(src), "-vn",
            "-af", f"loudnorm=I={target_i}:TP={tp}:LRA={lra}:print_format=json",
            "-f", "null", "-",
        ],
        capture_output=True, text=True, timeout=1800,
    )
    out = proc.stderr or ""
    start = out.rfind("{")
    end = out.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(out[start:end + 1])
    except json.JSONDecodeError:
        return None


def loudnorm_filter(measured: dict | None, target_i: float = -14.0, tp: float = -1.5, lra: float = 11.0) -> str:
    base = f"loudnorm=I={target_i}:TP={tp}:LRA={lra}"
    if not measured:
        return base
    try:
        return (
            base
            + f":measured_I={float(measured['input_i'])}"
            + f":measured_TP={float(measured['input_tp'])}"
            + f":measured_LRA={float(measured['input_lra'])}"
            + f":measured_thresh={float(measured['input_thresh'])}"
            + f":offset={float(measured.get('target_offset', 0))}"
            + ":linear=true"
        )
    except (KeyError, ValueError):
        return base


# ---------------------------------------------------------------------------
# Jump cuts: saltear pausas largas
# ---------------------------------------------------------------------------
def keep_ranges_from_words(words: list[dict], duration: float, min_pause_s: float, keep_pause_s: float,
                           min_removed_s: float = 0.15) -> list[tuple[float, float]]:
    """A partir de palabras con tiempos relativos al segmento, devuelve los rangos
    que se conservan (se quitan las pausas más largas que min_pause_s, dejando
    keep_pause_s de aire repartido a ambos lados)."""
    ranges: list[tuple[float, float]] = []
    cursor = 0.0
    half = keep_pause_s / 2.0
    ws = sorted((w for w in words if w["e"] > 0 and w["s"] < duration), key=lambda w: w["s"])
    for prev, nxt in zip(ws, ws[1:]):
        gap_start, gap_end = prev["e"] + half, nxt["s"] - half
        if (nxt["s"] - prev["e"]) > min_pause_s and (gap_end - gap_start) > min_removed_s:
            ranges.append((cursor, max(cursor, gap_start)))
            cursor = gap_end
    ranges.append((cursor, duration))
    return [(round(a, 3), round(b, 3)) for a, b in ranges if b - a > 0.02]


def remap_time(t: float, ranges: list[tuple[float, float]]) -> float:
    """Tiempo del segmento original -> tiempo en el segmento con cortes."""
    acc = 0.0
    for a, b in ranges:
        if t < a:
            return acc
        if t <= b:
            return acc + (t - a)
        acc += b - a
    return acc


def cut_points(ranges: list[tuple[float, float]]) -> list[float]:
    """Instantes (en el timeline cortado) donde hay un salto."""
    out: list[float] = []
    acc = 0.0
    for a, b in ranges[:-1]:
        acc += b - a
        out.append(round(acc, 3))
    return out


def cut_ranges(src: Path, dst: Path, ranges: list[tuple[float, float]], *, fps: float | None = None, audio: bool = True) -> Path:
    """Conserva solo los rangos indicados (re-codifica, CFR)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    expr = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in ranges)
    vf = f"select='{expr}',setpts=N/FRAME_RATE/TB"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", vf]
    if audio:
        cmd += ["-af", f"aselect='{expr}',asetpts=N/SR/TB"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-fps_mode", "cfr"]
    if fps:
        cmd += ["-r", f"{fps:.3f}"]
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    cmd += ["-movflags", "+faststart", str(dst)]
    run(cmd, timeout=3600)
    return dst


# ---------------------------------------------------------------------------
# Música de fondo
# ---------------------------------------------------------------------------
def mix_music(voice_src: Path, music: Path, dst: Path, *, duration: float, volume_db: float = -20.0,
              duck: bool = True, fade_out_s: float = 2.0) -> Path:
    """Mezcla la voz del segmento con música en loop, más baja y con ducking
    (la música baja cuando hay voz). Devuelve un WAV estéreo 48 kHz."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    fade = max(0.0, min(fade_out_s, duration / 2))
    music_chain = f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{duration:.3f},asetpts=N/SR/TB,volume={volume_db:.1f}dB"
    if fade > 0:
        music_chain += f",afade=t=out:st={duration - fade:.3f}:d={fade:.3f}"
    music_chain += "[m]"
    voice_chain = "[0:a]aformat=sample_rates=48000:channel_layouts=stereo[v]"
    if duck:
        graph = (
            f"{voice_chain};{music_chain};"
            "[v]asplit=2[v1][v2];"
            "[m][v2]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=600[md];"
            "[v1][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
        )
    else:
        graph = f"{voice_chain};{music_chain};[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(voice_src), "-stream_loop", "-1", "-i", str(music),
        "-filter_complex", graph, "-map", "[a]", "-t", f"{duration:.3f}", "-c:a", "pcm_s16le", str(dst),
    ], timeout=1800)
    return dst
