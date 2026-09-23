"""Presets visuales. Los de fábrica viven acá; los del usuario, en la tabla presets.

Cada preset controla tipografía, tamaño, color, posición y cantidad de líneas de
subtítulos, título, efectos de cámara, tratamiento de dos hablantes y márgenes
seguros (para que nada quede tapado por la interfaz de Instagram/TikTok).
"""
from __future__ import annotations

import copy

from . import db

DEFAULT_PRESET_ID = "natural"


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _base(**over) -> dict:
    """Preset completo con valores sobrios; cada preset de fábrica sobreescribe lo suyo."""
    cfg = {
        "name": "",
        "description": "",
        "target_duration": {"min": 60, "max": 120},
        "subtitles": {
            "font": "Inter",
            "bold": False,
            "size": 62,
            "color": "#FFFFFF",
            "shadow": True,
            "outline": 0,
            "lines": 1,
            "max_chars_per_line": 26,
            "words_per_cue": 0,          # 0 = por largo de línea; 1-3 = estilo "palabra por palabra"
            "position": "bottom",        # bottom | middle
            "highlight": False,
            "highlight_color": "#FFD400",
            "uppercase": False,
            "box": False,                # caja de fondo detrás del texto
            "box_color": "#000000",
            "box_opacity": 0.6,
            "animation": "none",         # none | pop
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
            "box": False,
            "box_color": "#000000",
            "box_opacity": 0.7,
        },
        "camera": {
            "zoom_on_speaker_change": False,
            "zoom_amount": 1.0,
            "smoothing": 0.85,
        },
        "two_speakers": "switch",
        "cuts": {
            "remove_silences": False,    # saltar pausas largas (jump cuts)
            "min_pause_s": 0.7,          # pausa mínima para cortarla
            "keep_pause_s": 0.25,        # cuánto silencio dejar en cada corte
        },
        "transitions": "none",           # none | punch | flash
        "music": {
            "enabled": False,
            "track": "random",           # "random" o ruta en Storage (music/...)
            "volume_db": -20,            # volumen de la música respecto de la voz
            "duck": True,                # bajar la música cuando hay voz
            "fade_out_s": 2,
        },
        "progress_bar": {"enabled": False, "color": "#FFFFFF", "height": 10},
        "safe_area": {"top": 260, "bottom": 420, "left": 60, "right": 130},
    }
    return _deep_merge(cfg, over)


BUILTIN_PRESETS: dict[str, dict] = {
    "natural": _base(
        name="Natural minimalista",
        description="Sin emojis, sin zooms, sin resaltados, sin música. Subtítulos de una línea, Inter, blanco con sombra suave. Cortes limpios.",
    ),
    "editorial": _base(
        name="Editorial",
        description="Sobrio, con título corto de dos líneas arriba durante 3 segundos, tipografía serif, subtítulos en 2 líneas.",
        subtitles={"font": "Liberation Serif", "size": 58, "lines": 2, "max_chars_per_line": 28},
        title={"show": True, "font": "Liberation Serif", "size": 72},
    ),
    "intermedio": _base(
        name="Intermedio",
        description="Subtítulos blancos más grandes con contorno, título los primeros 3 segundos, se saltean las pausas largas. Sin música ni zooms.",
        target_duration={"min": 45, "max": 90},
        subtitles={"font": "Inter", "bold": True, "size": 70, "outline": 3, "lines": 2, "max_chars_per_line": 24},
        title={"show": True, "size": 64, "box": True},
        cuts={"remove_silences": True, "min_pause_s": 1.0, "keep_pause_s": 0.3},
    ),
    "podcast": _base(
        name="Podcast a dos",
        description="Para charlas con dos personas en cámara: pantalla dividida arriba/abajo, subtítulos en 2 líneas, sin efectos.",
        subtitles={"lines": 2, "size": 58, "max_chars_per_line": 28},
        two_speakers="split",
        title={"show": True, "duration_s": 3},
    ),
    "dinamico": _base(
        name="Dinámico",
        description="Palabra activa resaltada, leve zoom en cambios de hablante y en cada corte, título permanente, pausas recortadas.",
        target_duration={"min": 45, "max": 90},
        subtitles={"bold": True, "size": 68, "outline": 3, "lines": 2, "max_chars_per_line": 22, "highlight": True},
        title={"show": True, "permanent": True, "size": 64},
        camera={"zoom_on_speaker_change": True, "zoom_amount": 1.12, "smoothing": 0.8},
        cuts={"remove_silences": True, "min_pause_s": 0.8, "keep_pause_s": 0.25},
        transitions="punch",
    ),
    "viral": _base(
        name="Viral (cargado)",
        description="Estilo Hormozi: 1-3 palabras por vez en mayúsculas, grandes, en el centro, resaltado amarillo, animación pop, hook con caja arriba, jump cuts agresivos, punch zoom en cada corte, música de fondo baja, barra de progreso. Clips cortos.",
        target_duration={"min": 30, "max": 60},
        subtitles={
            "font": "Montserrat", "bold": True, "size": 92, "outline": 5, "lines": 1, "max_chars_per_line": 18,
            "words_per_cue": 3, "position": "middle", "highlight": True, "highlight_color": "#FFE600",
            "uppercase": True, "animation": "pop",
        },
        title={"show": True, "permanent": False, "duration_s": 4, "font": "Montserrat", "size": 62, "box": True, "lines": 2},
        camera={"zoom_on_speaker_change": True, "zoom_amount": 1.15, "smoothing": 0.75},
        cuts={"remove_silences": True, "min_pause_s": 0.45, "keep_pause_s": 0.15},
        transitions="punch",
        music={"enabled": True, "track": "random", "volume_db": -18, "duck": True, "fade_out_s": 2},
        progress_bar={"enabled": True, "color": "#FFE600", "height": 12},
    ),
}



def normalize(config: dict) -> dict:
    """Completa un preset parcial con los valores por defecto (y convierte campos viejos)."""
    config = dict(config or {})
    if isinstance(config.get("progress_bar"), bool):
        config["progress_bar"] = {"enabled": config["progress_bar"]}
    return _deep_merge(BUILTIN_PRESETS[DEFAULT_PRESET_ID], config)


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
        cfg = normalize(BUILTIN_PRESETS[pid])
        cfg["id"] = pid
        return cfg
    cfg = copy.deepcopy(BUILTIN_PRESETS[DEFAULT_PRESET_ID])
    cfg["id"] = DEFAULT_PRESET_ID
    return cfg


def ensure_builtin_presets() -> None:
    db.upsert_builtin_presets(BUILTIN_PRESETS)
