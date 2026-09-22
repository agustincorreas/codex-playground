"""Deepgram (REST). Modelo por defecto: nova-3, con diarización."""
from __future__ import annotations

from pathlib import Path

import requests

from ..config import config
from ..errors import RetryableError, UserError


def transcribe(audio_path: Path, language: str) -> dict:
    params = {
        "model": config.DEEPGRAM_MODEL,
        "language": language,
        "diarize": "true",
        "punctuate": "true",
        "smart_format": "true",
        "utterances": "true",
    }
    with open(audio_path, "rb") as f:
        resp = requests.post(
            "https://api.deepgram.com/v1/listen",
            params=params,
            headers={"Authorization": f"Token {config.DEEPGRAM_API_KEY}", "Content-Type": "audio/mpeg"},
            data=f,
            timeout=3600,
        )
    if resp.status_code == 401:
        raise UserError("Deepgram rechazó la API key (DEEPGRAM_API_KEY).")
    if resp.status_code == 402:
        raise UserError("Deepgram: sin crédito en la cuenta.")
    if resp.status_code >= 500:
        raise RetryableError(f"Deepgram respondió {resp.status_code}")
    if resp.status_code >= 400:
        raise UserError(f"Deepgram respondió {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        alt = data["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError):
        return {"words": [], "language": language}
    words = []
    for w in alt.get("words", []):
        words.append({
            "t": w.get("punctuated_word") or w.get("word") or "",
            "s": float(w["start"]),
            "e": float(w["end"]),
            "spk": w.get("speaker"),
        })
    detected = None
    try:
        detected = data["results"]["channels"][0].get("detected_language")
    except (KeyError, IndexError):
        pass
    return {"words": words, "language": detected or language}
