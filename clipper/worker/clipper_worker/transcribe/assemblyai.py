"""AssemblyAI (REST) con speaker_labels."""
from __future__ import annotations

import time
from pathlib import Path

import requests

from ..config import config
from ..errors import RetryableError, UserError

BASE = "https://api.assemblyai.com/v2"


def _headers() -> dict:
    return {"authorization": config.ASSEMBLYAI_API_KEY or ""}


def transcribe(audio_path: Path, language: str) -> dict:
    with open(audio_path, "rb") as f:
        up = requests.post(f"{BASE}/upload", headers=_headers(), data=f, timeout=3600)
    if up.status_code == 401:
        raise UserError("AssemblyAI rechazó la API key (ASSEMBLYAI_API_KEY).")
    if up.status_code >= 400:
        raise RetryableError(f"AssemblyAI upload: {up.status_code} {up.text[:200]}")
    audio_url = up.json()["upload_url"]

    body = {
        "audio_url": audio_url,
        "language_code": language,
        "speaker_labels": True,
        "punctuate": True,
        "format_text": True,
        "speech_model": "universal",
    }
    created = requests.post(f"{BASE}/transcript", headers=_headers(), json=body, timeout=60)
    if created.status_code >= 400:
        raise UserError(f"AssemblyAI respondió {created.status_code}: {created.text[:300]}")
    tid = created.json()["id"]

    deadline = time.time() + 3600 * 2
    while time.time() < deadline:
        r = requests.get(f"{BASE}/transcript/{tid}", headers=_headers(), timeout=60)
        if r.status_code >= 500:
            time.sleep(10)
            continue
        data = r.json()
        status = data.get("status")
        if status == "completed":
            break
        if status == "error":
            raise UserError(f"AssemblyAI no pudo transcribir: {data.get('error', '')[:300]}")
        time.sleep(5)
    else:
        raise RetryableError("AssemblyAI tardó demasiado.")

    speakers: dict[str, int] = {}
    words = []
    for w in data.get("words") or []:
        spk = w.get("speaker")
        if spk is not None and spk not in speakers:
            speakers[spk] = len(speakers)
        words.append({
            "t": w.get("text") or "",
            "s": float(w["start"]) / 1000.0,
            "e": float(w["end"]) / 1000.0,
            "spk": speakers.get(spk) if spk is not None else None,
        })
    return {"words": words, "language": data.get("language_code") or language}
