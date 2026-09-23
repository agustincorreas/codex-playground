"""Whisper local (sin API) con sherpa-onnx: VAD Silero + Whisper multilingüe.

Pensado para pruebas o videos cortos: no diariza y los tiempos por palabra son
aproximados (se reparten dentro de cada tramo de voz que detecta el VAD según
el largo de cada palabra). Requiere `pip install sherpa-onnx` y los modelos:

  LOCAL_WHISPER_DIR   carpeta con <size>-encoder*.onnx, <size>-decoder*.onnx y <size>-tokens.txt
                      (por ejemplo sherpa-onnx-whisper-small de los releases de k2-fsa/sherpa-onnx)
  LOCAL_VAD_MODEL     ruta a silero_vad.onnx
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from ..errors import UserError
from ..log import get_logger

log = get_logger(__name__)

SAMPLE_RATE = 16000


def _load_wav(audio_path: Path, tmp: Path) -> np.ndarray:
    wav = tmp / "audio16k.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(audio_path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", str(wav)],
        check=True, capture_output=True,
    )
    with wave.open(str(wav), "rb") as f:
        frames = f.readframes(f.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def _find_model(model_dir: Path) -> tuple[str, str, str]:
    encoders = sorted(model_dir.glob("*-encoder*.onnx"))
    decoders = sorted(model_dir.glob("*-decoder*.onnx"))
    tokens = sorted(model_dir.glob("*-tokens.txt"))
    if not (encoders and decoders and tokens):
        raise UserError(f"No encontré el modelo Whisper en {model_dir} (LOCAL_WHISPER_DIR).")
    # Preferimos la versión int8 (más rápida en CPU) si existe.
    enc = next((e for e in encoders if "int8" in e.name), encoders[0])
    dec = next((d for d in decoders if "int8" in d.name), decoders[0])
    return str(enc), str(dec), str(tokens[0])


def _spread_words(text: str, start: float, end: float) -> list[dict]:
    tokens = text.split()
    if not tokens:
        return []
    weights = [max(1, len(re.sub(r"[^\wáéíóúüñÁÉÍÓÚÜÑ]", "", t))) + 0.5 for t in tokens]
    total = sum(weights)
    out = []
    t = start
    span = max(0.1, end - start)
    for tok, w in zip(tokens, weights):
        d = span * w / total
        out.append({"t": tok, "s": round(t, 3), "e": round(min(end, t + d * 0.9), 3), "spk": None})
        t += d
    return out


def transcribe(audio_path: Path, language: str) -> dict:
    try:
        import sherpa_onnx
    except ImportError as e:
        raise UserError("El proveedor 'local' necesita `pip install sherpa-onnx`.") from e

    model_dir = Path(os.environ.get("LOCAL_WHISPER_DIR", "/opt/models/whisper"))
    vad_model = os.environ.get("LOCAL_VAD_MODEL", "/opt/models/silero_vad.onnx")
    if not Path(vad_model).exists():
        raise UserError(f"No encontré el modelo de VAD en {vad_model} (LOCAL_VAD_MODEL).")
    enc, dec, tok = _find_model(model_dir)
    threads = max(1, os.cpu_count() or 1)

    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=enc, decoder=dec, tokens=tok, language=language, task="transcribe",
        num_threads=threads, tail_paddings=-1,
    )
    vad_cfg = sherpa_onnx.VadModelConfig()
    vad_cfg.silero_vad.model = vad_model
    vad_cfg.silero_vad.threshold = 0.5
    vad_cfg.silero_vad.min_silence_duration = 0.3
    vad_cfg.silero_vad.min_speech_duration = 0.25
    vad_cfg.silero_vad.max_speech_duration = 20.0
    vad_cfg.sample_rate = SAMPLE_RATE
    vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=60)
    window = vad_cfg.silero_vad.window_size

    words: list[dict] = []
    with tempfile.TemporaryDirectory() as td:
        samples = _load_wav(audio_path, Path(td))

    def handle_segment(seg) -> None:
        start = seg.start / SAMPLE_RATE
        end = start + len(seg.samples) / SAMPLE_RATE
        stream = recognizer.create_stream()
        stream.accept_waveform(SAMPLE_RATE, seg.samples)
        recognizer.decode_stream(stream)
        text = (stream.result.text or "").strip()
        if text:
            words.extend(_spread_words(text, start, end))

    n = len(samples)
    for i in range(0, n, window):
        chunk = samples[i:i + window]
        if len(chunk) < window:
            chunk = np.pad(chunk, (0, window - len(chunk)))
        vad.accept_waveform(chunk)
        while not vad.empty():
            handle_segment(vad.front)
            vad.pop()
    vad.flush()
    while not vad.empty():
        handle_segment(vad.front)
        vad.pop()
    log.info("whisper local: %d palabras en %.0f s de audio", len(words), n / SAMPLE_RATE)
    return {"words": words, "language": language}
