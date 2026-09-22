"""Transcripción con timestamps por palabra y diarización.

Proveedor configurable con TRANSCRIBE_PROVIDER: deepgram | assemblyai | openai.
Todos devuelven el mismo formato:

    {
      "provider": "deepgram",
      "language": "es",
      "words": [{"t": "Hola,", "s": 0.12, "e": 0.40, "spk": 0}, ...]
    }

`t` incluye la puntuación cuando el proveedor la da; `spk` es el índice del
hablante (None si el proveedor no diariza).
"""
from __future__ import annotations

from pathlib import Path

from ..config import config
from ..errors import UserError


def transcribe(audio_path: Path, language: str | None = None) -> dict:
    language = language or config.TRANSCRIBE_LANGUAGE or "es"
    provider = config.TRANSCRIBE_PROVIDER
    if provider == "deepgram":
        from . import deepgram as impl
    elif provider == "assemblyai":
        from . import assemblyai as impl
    elif provider == "openai":
        from . import openai_whisper as impl
    else:
        raise UserError(f"Proveedor de transcripción desconocido: {provider}")
    result = impl.transcribe(audio_path, language)
    words = [w for w in result.get("words", []) if w.get("t")]
    if len(words) < 20:
        raise UserError(
            "La transcripción quedó vacía o casi vacía. ¿El video tiene voz? "
            "Si es música o silencio no hay nada para recortar."
        )
    result["words"] = words
    result["provider"] = provider
    return result
