"""Presets visuales. Los de fábrica viven acá; los del usuario, en la tabla presets.

Cada preset controla tipografía, tamaño, color, posición y cantidad de líneas de
subtítulos, título, efectos de cámara, tratamiento de dos hablantes y márgenes
seguros (para que nada quede tapado por la interfaz de Instagram/TikTok).
"""
from __future__ import annotations

import copy

from . import db

BUILTIN_PRESETS: dict[str, dict] = {
    "natural": {
        "name": "Natural minimalista",
        "description": "Sin emojis, sin zooms, sin resaltados. Subtítulos de una línea, Inter, blanco con sombra suave.",
        "subtitles": {
            "font": "Inter",
            "bold": False,
            "size": 62,
            "color": "#FFFFFF",
            "shadow": True,
            "outline": 0,
            "lines": 1,
            "max_chars_per_line": 26,
            "position": "bottom",
            "highlight": False,
            "highlight_color": "#FFD400",
            "uppercase": False,
        },
        "title": {
            "show": False,
            "permanent": False,
            "duration_s": 3,
            "font": "Inter",
            "bold": True,
            "size": 66,
            "color": "#FFFFFF",
            "lines": 2,
        },
        "camera": {
            "zoom_on_speaker_change": False,
            "zoom_amount": 1.0,
            "smoothing": 0.85,
        },
        "two_speakers": "switch",
        "safe_area": {"top": 260, "bottom": 420, "left": 60, "right": 130},
        "transitions": "none",
        "progress_bar": False,
    },
    "editorial": {
        "name": "Editorial",
        "description": "Sobrio, con título corto de dos líneas arriba durante 3 segundos, tipografía serif, subtítulos en 2 líneas.",
        "subtitles": {
            "font": "Liberation Serif",
            "bold": False,
            "size": 58,
            "color": "#FFFFFF",
            "shadow": True,
            "outline": 0,
            "lines": 2,
            "max_chars_per_line": 28,
            "position": "bottom",
            "highlight": False,
            "highlight_color": "#FFD400",
            "uppercase": False,
        },
        "title": {
            "show": True,
            "permanent": False,
            "duration_s": 3,
            "font": "Liberation Serif",
            "bold": True,
            "size": 72,
            "color": "#FFFFFF",
            "lines": 2,
        },
        "camera": {
            "zoom_on_speaker_change": False,
            "zoom_amount": 1.0,
            "smoothing": 0.85,
        },
        "two_speakers": "switch",
        "safe_area": {"top": 260, "bottom": 420, "left": 60, "right": 130},
        "transitions": "none",
        "progress_bar": False,
    },
    "dinamico": {
        "name": "Dinámico",
        "description": "Palabra activa resaltada, leve zoom en cambios de hablante, título permanente.",
        "subtitles": {
            "font": "Inter",
            "bold": True,
            "size": 68,
            "color": "#FFFFFF",
            "shadow": True,
            "outline": 3,
            "lines": 2,
            "max_chars_per_line": 22,
            "position": "bottom",
            "highlight": True,
            "highlight_color": "#FFD400",
            "uppercase": False,
        },
        "title": {
            "show": True,
            "permanent": True,
            "duration_s": 3,
            "font": "Inter",
            "bold": True,
            "size": 64,
            "color": "#FFFFFF",
            "lines": 2,
        },
        "camera": {
            "zoom_on_speaker_change": True,
            "zoom_amount": 1.12,
            "smoothing": 0.8,
        },
        "two_speakers": "switch",
        "safe_area": {"top": 260, "bottom": 420, "left": 60, "right": 130},
        "transitions": "none",
        "progress_bar": False,
    },
}

DEFAULT_PRESET_ID = "natural"


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def normalize(config: dict) -> dict:
    """Completa un preset parcial con los valores del preset natural."""
    return _deep_merge(BUILTIN_PRESETS[DEFAULT_PRESET_ID], config or {})


def load_preset(preset_id: str | None) -> dict:
    pid = preset_id or DEFAULT_PRESET_ID
    row = None
    try:
        row = db.get_preset(pid)
    except Exception:  # sin base (tests) usamos los de fábrica
        row = None
    if row and row.get("config"):
        cfg = normalize(row["config"])
        cfg["id"] = pid
        return cfg
    if pid in BUILTIN_PRESETS:
        cfg = copy.deepcopy(BUILTIN_PRESETS[pid])
        cfg["id"] = pid
        return cfg
    cfg = copy.deepcopy(BUILTIN_PRESETS[DEFAULT_PRESET_ID])
    cfg["id"] = DEFAULT_PRESET_ID
    return cfg


def ensure_builtin_presets() -> None:
    db.upsert_builtin_presets(BUILTIN_PRESETS)
