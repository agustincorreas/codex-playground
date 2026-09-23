"""Título dibujado con Pillow (para componerlo por detrás de la persona)."""
from __future__ import annotations

import subprocess
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .subtitles import wrap_lines

OUT_W, OUT_H = 1080, 1920


@lru_cache(maxsize=16)
def font_file(family: str, bold: bool) -> str:
    pattern = f"{family}:bold" if bold else family
    proc = subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True)
    path = (proc.stdout or "").strip()
    return path or "DejaVuSans.ttf"


def _rgba(hex_color: str, alpha: float = 1.0) -> tuple[int, int, int, int]:
    c = (hex_color or "#FFFFFF").lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), int(round(255 * alpha))


def render_title(title: str, preset: dict) -> np.ndarray:
    """Devuelve una capa RGBA (OUT_H, OUT_W, 4) con el título arriba, centrado."""
    ttl = preset.get("title", {})
    safe = preset.get("safe_area", {})
    size = int(ttl.get("size", 66))
    font = ImageFont.truetype(font_file(ttl.get("font", "Inter"), bool(ttl.get("bold", True))), size)
    lines = wrap_lines(title.strip(), int(ttl.get("lines", 2)), 22)
    img = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    line_h = int(size * 1.25)
    y = int(safe.get("top", 260))
    color = _rgba(ttl.get("color", "#FFFFFF"))
    stroke = 3
    if ttl.get("box"):
        pad_x, pad_y = int(size * 0.35), int(size * 0.18)
        widths = [draw.textlength(line, font=font) for line in lines]
        bw = int(max(widths)) + 2 * pad_x
        bh = line_h * len(lines) + 2 * pad_y
        x0 = (OUT_W - bw) // 2
        draw.rounded_rectangle([x0, y - pad_y, x0 + bw, y - pad_y + bh], radius=int(size * 0.2),
                               fill=_rgba(ttl.get("box_color", "#000000"), float(ttl.get("box_opacity", 0.7))))
        stroke = 0
    for line in lines:
        w = draw.textlength(line, font=font)
        x = (OUT_W - w) / 2
        draw.text((x, y), line, font=font, fill=color, stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
        y += line_h
    return np.array(img)


def composite_behind(canvas_bgr: np.ndarray, title_rgba: np.ndarray, person_mask: np.ndarray, alpha: float = 1.0) -> np.ndarray:
    """Pone el título sobre el cuadro y vuelve a poner la persona por encima."""
    title_a = (title_rgba[:, :, 3:4].astype(np.float32) / 255.0) * alpha
    title_rgb = title_rgba[:, :, :3][:, :, ::-1].astype(np.float32)  # RGB -> BGR
    base = canvas_bgr.astype(np.float32)
    with_title = base * (1.0 - title_a) + title_rgb * title_a
    m = person_mask[:, :, None]
    out = with_title * (1.0 - m) + base * m
    return np.clip(out, 0, 255).astype(np.uint8)
