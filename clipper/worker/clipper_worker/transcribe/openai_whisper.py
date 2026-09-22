"""OpenAI Whisper (REST). Sin diarización; el audio se parte en trozos < 25 MB."""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

import requests

from ..config import config
from ..errors import RetryableError, UserError

MAX_BYTES = 24 * 1024 * 1024
CHUNK_SECONDS = 1500  # 25 min a 48 kbps ≈ 9 MB


def _split(audio_path: Path, tmp: Path) -> list[tuple[Path, float]]:
    if audio_path.stat().st_size <= MAX_BYTES:
        return [(audio_path, 0.0)]
    pattern = tmp / "chunk_%03d.mp3"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(audio_path),
            "-f", "segment", "-segment_time", str(CHUNK_SECONDS), "-c", "copy", str(pattern),
        ],
        check=True, capture_output=True,
    )
    chunks = sorted(tmp.glob("chunk_*.mp3"))
    return [(c, i * float(CHUNK_SECONDS)) for i, c in enumerate(chunks)]


def _call(chunk: Path, language: str) -> dict:
    with open(chunk, "rb") as f:
        resp = requests.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {config.OPENAI_API_KEY}"},
            files={"file": (chunk.name, f, "audio/mpeg")},
            data={
                "model": config.OPENAI_TRANSCRIBE_MODEL,
                "response_format": "verbose_json",
                "timestamp_granularities[]": ["word", "segment"],
                "language": language,
            },
            timeout=3600,
        )
    if resp.status_code == 401:
        raise UserError("OpenAI rechazó la API key (OPENAI_API_KEY).")
    if resp.status_code >= 500 or resp.status_code == 429:
        raise RetryableError(f"OpenAI respondió {resp.status_code}")
    if resp.status_code >= 400:
        raise UserError(f"OpenAI respondió {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _attach_punctuation(words: list[dict], segments: list[dict]) -> None:
    """Whisper devuelve las palabras sin puntuación; se la agregamos desde los
    segmentos para que la división en oraciones funcione."""
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        s, e = float(seg.get("start", 0)), float(seg.get("end", 0))
        seg_words = [w for w in words if w["s"] >= s - 0.05 and w["e"] <= e + 0.05]
        tokens = text.split()
        if not seg_words:
            continue
        if len(tokens) == len(seg_words):
            for w, tok in zip(seg_words, tokens):
                w["t"] = tok
        else:
            if re.search(r"[.?!…]$", text):
                seg_words[-1]["t"] = seg_words[-1]["t"].rstrip(".?!…") + text[-1]


def transcribe(audio_path: Path, language: str) -> dict:
    words: list[dict] = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for chunk, offset in _split(audio_path, tmp):
            data = _call(chunk, language)
            chunk_words = [
                {"t": w.get("word", "").strip(), "s": float(w["start"]), "e": float(w["end"]), "spk": None}
                for w in data.get("words") or []
            ]
            _attach_punctuation(chunk_words, data.get("segments") or [])
            for w in chunk_words:
                w["s"] += offset
                w["e"] += offset
            words.extend(chunk_words)
    return {"words": words, "language": language}
