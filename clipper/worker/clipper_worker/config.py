"""Configuración por variables de entorno."""
from __future__ import annotations

import os
from pathlib import Path


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)) or default)
    except ValueError:
        return default


class Config:
    # Supabase
    DATABASE_URL = _env("DATABASE_URL")
    SUPABASE_URL = (_env("SUPABASE_URL") or "").rstrip("/")
    SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")
    STORAGE_BUCKET = _env("STORAGE_BUCKET", "clipper")

    # Transcripción: deepgram | assemblyai | openai | local
    TRANSCRIBE_PROVIDER = (_env("TRANSCRIBE_PROVIDER", "deepgram") or "deepgram").lower()
    DEEPGRAM_API_KEY = _env("DEEPGRAM_API_KEY")
    DEEPGRAM_MODEL = _env("DEEPGRAM_MODEL", "nova-3")
    ASSEMBLYAI_API_KEY = _env("ASSEMBLYAI_API_KEY")
    OPENAI_API_KEY = _env("OPENAI_API_KEY")
    OPENAI_TRANSCRIBE_MODEL = _env("OPENAI_TRANSCRIBE_MODEL", "whisper-1")
    TRANSCRIBE_LANGUAGE = _env("TRANSCRIBE_LANGUAGE", "es")

    # Selección de momentos (Claude)
    ANTHROPIC_API_KEY = _env("ANTHROPIC_API_KEY")
    CLAUDE_MODEL = _env("CLAUDE_MODEL", "claude-opus-5")
    CLAUDE_EFFORT = _env("CLAUDE_EFFORT", "high")
    CORRECT_TRANSCRIPT = (_env("CORRECT_TRANSCRIPT", "true") or "true").lower() != "false"
    CORRECTION_WEB_SEARCH = (_env("CORRECTION_WEB_SEARCH", "true") or "true").lower() != "false"
    MIN_CANDIDATES = _int("MIN_CANDIDATES", 6)
    MAX_CANDIDATES = _int("MAX_CANDIDATES", 15)

    # Google (Drive)
    GOOGLE_CLIENT_ID = _env("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = _env("GOOGLE_CLIENT_SECRET")

    # Descarga
    YTDLP_MAX_HEIGHT = _int("YTDLP_MAX_HEIGHT", 720)

    # Render
    OUTPUT_W = 1080
    OUTPUT_H = 1920
    MAX_OUTPUT_MB = _int("MAX_OUTPUT_MB", 60)
    PREVIEW_PAD_S = _int("PREVIEW_PAD_S", 20)
    PREVIEW_HEIGHT = _int("PREVIEW_HEIGHT", 360)
    FACE_MODEL_PATH = _env("FACE_MODEL_PATH", "/opt/models/face_detection_yunet_2023mar.onnx")
    SEGMENTATION_MODEL_PATH = _env("SEGMENTATION_MODEL_PATH", "/opt/models/u2net_human_seg.onnx")
    FFMPEG_THREADS = _int("FFMPEG_THREADS", 0)
    X264_PRESET = _env("X264_PRESET", "medium")

    # Archivos locales
    WORK_DIR = Path(_env("WORK_DIR", "/data/clipper") or "/data/clipper")
    POLL_INTERVAL_S = _int("POLL_INTERVAL_S", 3)
    SOURCE_CACHE_GB = _int("SOURCE_CACHE_GB", 8)

    @classmethod
    def validate(cls) -> list[str]:
        missing = []
        if not cls.DATABASE_URL:
            missing.append("DATABASE_URL")
        if not cls.SUPABASE_URL:
            missing.append("SUPABASE_URL")
        if not cls.SUPABASE_SERVICE_ROLE_KEY:
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if not cls.ANTHROPIC_API_KEY:
            missing.append("ANTHROPIC_API_KEY")
        provider_keys = {
            "deepgram": "DEEPGRAM_API_KEY",
            "assemblyai": "ASSEMBLYAI_API_KEY",
            "openai": "OPENAI_API_KEY",
            "local": None,
        }
        if cls.TRANSCRIBE_PROVIDER not in provider_keys:
            missing.append(f"TRANSCRIBE_PROVIDER inválido: {cls.TRANSCRIBE_PROVIDER} (deepgram|assemblyai|openai|local)")
        else:
            key = provider_keys[cls.TRANSCRIBE_PROVIDER]
            if key and not getattr(cls, key):
                missing.append(key)
        return missing


config = Config
