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
SILENCE_FRAME_S = 0.02


def audio_envelope(src: Path, frame_s: float = SILENCE_FRAME_S):
    """RMS por tramos de `frame_s` del audio (mono 16 kHz). Devuelve (rms, frame_s)."""
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        capture_output=True, timeout=1800,
    )
    if proc.returncode != 0 or not proc.stdout:
        return None, frame_s
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    n = int(16000 * frame_s)
    if n <= 0 or len(samples) < n:
        return None, frame_s
    frames = samples[: len(samples) // n * n].reshape(-1, n)
    return np.sqrt(np.mean(frames * frames, axis=1)), frame_s


LEAD_IN_S = 0.25    # aire que se deja antes de la primera palabra
TAIL_S = 0.6        # aire que se deja después de la última palabra


def keep_ranges_from_words(words: list[dict], duration: float, min_pause_s: float, keep_pause_s: float,
                           min_removed_s: float = 0.15, envelope=None, word_pad_s: float = 0.08,
                           forced_removals: list[tuple[float, float]] | None = None,
                           trim_edges: bool = True) -> list[tuple[float, float]]:
    """Rangos del segmento que se conservan.

    - Pausas: huecos entre palabras más largos que min_pause_s. Si se pasa `envelope`
      (RMS del audio, ver audio_envelope), cada pausa se achica al tramo que de verdad
      está en silencio, así nunca se corta una palabra aunque los tiempos de la
      transcripción sean aproximados. Se deja keep_pause_s de aire repartido a ambos
      lados del corte, más word_pad_s de margen junto a cada palabra.
    - Bordes (trim_edges): se quita el aire muerto antes de la primera palabra y después
      de la última (dejando LEAD_IN_S / TAIL_S).
    - forced_removals: tramos que se quitan sí o sí (falsos comienzos, repeticiones),
      con los bordes ajustados al silencio más cercano para que el corte no se note."""
    import numpy as np

    rms, frame_s = envelope if envelope else (None, SILENCE_FRAME_S)
    threshold = None
    if rms is not None and len(rms) > 10:
        noise = float(np.percentile(rms, 10))
        speech = float(np.percentile(rms, 80))
        threshold = max(noise * 3.0, speech * 0.12, 1e-4)

    def quiet_span(a: float, b: float) -> tuple[float, float] | None:
        """Sub-tramo silencioso más largo dentro de [a, b] según el audio."""
        if rms is None:
            return (a, b)
        i0, i1 = int(a / frame_s), int(b / frame_s)
        if i1 <= i0 or i1 > len(rms):
            return None
        quiet = rms[i0:i1] < threshold
        best, cur_start, best_len = None, None, 0
        for k, q in enumerate(quiet):
            if q and cur_start is None:
                cur_start = k
            if (not q or k == len(quiet) - 1) and cur_start is not None:
                end = k + 1 if q else k
                if end - cur_start > best_len:
                    best_len = end - cur_start
                    best = (cur_start, end)
                cur_start = None
        if best is None:
            return None
        return (a + best[0] * frame_s, a + best[1] * frame_s)

    def nearest_quiet(t: float, radius: float = 0.35) -> float:
        """Instante silencioso más cercano a t (o t si no hay audio/silencio cerca)."""
        if rms is None:
            return t
        best, best_d = t, None
        i_t = int(t / frame_s)
        r = int(radius / frame_s)
        for k in range(max(0, i_t - r), min(len(rms), i_t + r + 1)):
            if rms[k] < threshold:
                d = abs(k - i_t)
                if best_d is None or d < best_d:
                    best, best_d = k * frame_s, d
        return best

    # 1) Tramos a quitar: pausas entre palabras...
    removals: list[tuple[float, float]] = []
    half = keep_pause_s / 2.0
    ws = sorted((w for w in words if w["e"] > 0 and w["s"] < duration), key=lambda w: w["s"])
    for prev, nxt in zip(ws, ws[1:]):
        if (nxt["s"] - prev["e"]) <= min_pause_s:
            continue
        span = quiet_span(prev["e"] + word_pad_s, nxt["s"] - word_pad_s)
        if span is None:
            continue
        gap_start, gap_end = span[0] + half, span[1] - half
        if (span[1] - span[0]) > min_pause_s and (gap_end - gap_start) > min_removed_s:
            removals.append((gap_start, gap_end))
    # ...aire muerto al principio y al final...
    if trim_edges and ws:
        first_s, last_e = ws[0]["s"], ws[-1]["e"]
        span = quiet_span(0.0, max(0.0, first_s - word_pad_s))
        if span is not None:
            lead_end = span[1] - LEAD_IN_S
            if lead_end > min_removed_s:
                removals.append((0.0, lead_end))
        span = quiet_span(min(duration, last_e + word_pad_s), duration)
        if span is not None:
            tail_start = span[0] + TAIL_S
            if duration - tail_start > min_removed_s:
                removals.append((tail_start, duration))
    # ...y tramos forzados (falsos comienzos, repeticiones), con bordes en silencio.
    for a, b in (forced_removals or []):
        a2, b2 = nearest_quiet(max(0.0, a)), nearest_quiet(min(duration, b))
        if b2 - a2 > min_removed_s:
            removals.append((a2, b2))

    # 2) Unir tramos solapados y convertir a rangos que se conservan.
    removals.sort()
    merged: list[list[float]] = []
    for a, b in removals:
        if merged and a <= merged[-1][1] + 0.01:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    ranges: list[tuple[float, float]] = []
    cursor = 0.0
    for a, b in merged:
        if a > cursor:
            ranges.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < duration:
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
