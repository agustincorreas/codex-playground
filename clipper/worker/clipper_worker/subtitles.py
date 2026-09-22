"""Subtítulos quemados sincronizados por palabra, en formato ASS (libass)."""
from __future__ import annotations

import re
from pathlib import Path

OUT_W, OUT_H = 1080, 1920


def _hex_to_ass(color: str, alpha: int = 0) -> str:
    """'#RRGGBB' -> '&HAABBGGRR' (formato ASS)."""
    c = color.lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    r, g, b = c[0:2], c[2:4], c[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _inline_color(color: str) -> str:
    """'#RRGGBB' -> '&HBBGGRR&' para overrides inline (\\c)."""
    c = color.lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    return f"&H{c[4:6]}{c[2:4]}{c[0:2]}&".upper()


def _fmt_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def build_cues(words: list[dict], clip_start: float, clip_end: float, preset: dict) -> list[dict]:
    """Agrupa las palabras del rango del clip en cues (bloques de subtítulo).

    Un cue cierra al superar el largo máximo, en fin de oración, en una pausa
    o cuando cambia el hablante. Los tiempos son relativos al inicio del clip.
    """
    sub = preset["subtitles"]
    max_chars = int(sub.get("max_chars_per_line", 26)) * int(sub.get("lines", 1))
    inside = [w for w in words if w["e"] > clip_start and w["s"] < clip_end]
    cues: list[dict] = []
    current: list[dict] = []

    def flush():
        if not current:
            return
        text = " ".join(w["t"] for w in current)
        cues.append({
            "s": round(max(0.0, current[0]["s"] - clip_start), 3),
            "e": round(min(clip_end, current[-1]["e"]) - clip_start, 3),
            "text": text,
            "words": [
                {"t": w["t"], "s": round(max(0.0, w["s"] - clip_start), 3), "e": round(min(clip_end, w["e"]) - clip_start, 3)}
                for w in current
            ],
        })
        current.clear()

    for w in inside:
        if current:
            prev = current[-1]
            length = sum(len(x["t"]) + 1 for x in current) + len(w["t"])
            speaker_changed = prev.get("spk") is not None and w.get("spk") is not None and prev["spk"] != w["spk"]
            if length > max_chars or (w["s"] - prev["e"]) > 0.7 or speaker_changed:
                flush()
        current.append(w)
        if re.search(r"[.?!…]$", w["t"]) and sum(len(x["t"]) + 1 for x in current) > max_chars * 0.45:
            flush()
    flush()

    # Los cues se mantienen en pantalla hasta el siguiente (sin huecos cortos),
    # para que no parpadeen.
    for i, c in enumerate(cues):
        if i + 1 < len(cues):
            gap = cues[i + 1]["s"] - c["e"]
            if 0 < gap < 1.2:
                c["e"] = cues[i + 1]["s"]
        else:
            c["e"] = min(clip_end - clip_start, c["e"] + 0.4)
    return cues


def cue_key(start_s: float) -> str:
    """Clave estable de un cue para las ediciones del usuario (ms enteros; igual que en la web)."""
    return str(int(round(float(start_s) * 1000)))


def apply_edits(cues: list[dict], edits: dict | None) -> list[dict]:
    """Aplica textos editados por el usuario (clave: inicio del cue en milisegundos)."""
    if not edits:
        return cues
    out = []
    for c in cues:
        key = cue_key(c["s"])
        text = edits.get(key)
        if text is not None and text.strip() != "" and text.strip() != c["text"]:
            new_tokens = text.strip().split()
            c = dict(c)
            c["text"] = " ".join(new_tokens)
            old_words = c.get("words") or []
            if old_words and len(new_tokens) == len(old_words):
                c["words"] = [dict(w, t=tok) for w, tok in zip(old_words, new_tokens)]
            else:
                # Distribuimos las palabras nuevas de forma uniforme en el tiempo del cue.
                span = max(0.2, c["e"] - c["s"])
                step = span / max(1, len(new_tokens))
                c["words"] = [
                    {"t": tok, "s": round(c["s"] + i * step, 3), "e": round(c["s"] + (i + 1) * step, 3)}
                    for i, tok in enumerate(new_tokens)
                ]
        out.append(c)
    return out


def wrap_lines(text: str, lines: int, max_chars: int) -> list[str]:
    """Reparte el texto en hasta `lines` líneas lo más parejas posible."""
    tokens = text.split()
    if lines <= 1 or len(tokens) < 2:
        return [text]
    if lines == 2:
        best, best_score = None, None
        for k in range(1, len(tokens)):
            a, b = " ".join(tokens[:k]), " ".join(tokens[k:])
            score = max(len(a), len(b))
            if best_score is None or score < best_score:
                best, best_score = [a, b], score
        # Si entra cómodo en una sola línea, no partimos.
        if len(text) <= max_chars * 0.75:
            return [text]
        return best or [text]
    target = len(text) / lines
    out: list[list[str]] = [[]]
    count = 0
    for tok in tokens:
        if out[-1] and len(out) < lines and (count + len(tok) + 1 > target):
            out.append([])
            count = 0
        out[-1].append(tok)
        count += len(tok) + 1
    return [" ".join(line) for line in out if line]


def _style_line(name: str, font: str, size: int, color: str, bold: bool, outline: int, shadow: bool,
                alignment: int, margin_v: int, margin_l: int, margin_r: int) -> str:
    primary = _hex_to_ass(color)
    outline_color = _hex_to_ass("#000000", 0x30 if shadow and outline == 0 else 0x00)
    back = _hex_to_ass("#000000", 0x60)
    border = max(outline, 2 if shadow else 0)
    shadow_px = 2 if shadow else 0
    return (
        f"Style: {name},{font},{size},{primary},&H000000FF,{outline_color},{back},"
        f"{-1 if bold else 0},0,0,0,100,100,0,0,1,{border},{shadow_px},{alignment},{margin_l},{margin_r},{margin_v},1"
    )


def build_ass(cues: list[dict], preset: dict, title: str | None, duration: float) -> str:
    sub = preset["subtitles"]
    ttl = preset.get("title", {})
    safe = preset.get("safe_area", {})
    margin_bottom = int(safe.get("bottom", 420))
    margin_top = int(safe.get("top", 260))
    margin_l = int(safe.get("left", 60))
    margin_r = int(safe.get("right", 130))
    lines = int(sub.get("lines", 1))
    max_chars = int(sub.get("max_chars_per_line", 26))
    highlight = bool(sub.get("highlight"))
    hl_color = _inline_color(sub.get("highlight_color", "#FFD400"))
    base_color = _inline_color(sub.get("color", "#FFFFFF"))
    uppercase = bool(sub.get("uppercase"))
    soft = "{\\blur3}" if sub.get("shadow") and int(sub.get("outline", 0)) == 0 else ""

    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {OUT_W}",
        f"PlayResY: {OUT_H}",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        _style_line("Sub", sub.get("font", "Inter"), int(sub.get("size", 62)), sub.get("color", "#FFFFFF"),
                    bool(sub.get("bold")), int(sub.get("outline", 0)), bool(sub.get("shadow", True)),
                    2, margin_bottom, margin_l, margin_r),
        _style_line("Title", ttl.get("font", "Inter"), int(ttl.get("size", 66)), ttl.get("color", "#FFFFFF"),
                    bool(ttl.get("bold", True)), 2, True, 8, margin_top, margin_l, margin_r),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events: list[str] = []

    if ttl.get("show") and title:
        t_lines = wrap_lines(title.strip(), int(ttl.get("lines", 2)), 22)
        t_text = "\\N".join(_escape(x) for x in t_lines)
        t_end = duration if ttl.get("permanent") else min(duration, float(ttl.get("duration_s", 3)))
        events.append(f"Dialogue: 1,{_fmt_time(0)},{_fmt_time(t_end)},Title,,0,0,0,,{t_text}")

    for cue in cues:
        text = cue["text"].upper() if uppercase else cue["text"]
        if not highlight:
            wrapped = wrap_lines(text, lines, max_chars)
            body = "\\N".join(_escape(x) for x in wrapped)
            events.append(f"Dialogue: 0,{_fmt_time(cue['s'])},{_fmt_time(cue['e'])},Sub,,0,0,0,,{soft}{body}")
            continue
        words = cue.get("words") or []
        if not words:
            continue
        # Con resaltado: un evento por palabra activa, el resto del cue en color base.
        tokens = [w["t"].upper() if uppercase else w["t"] for w in words]
        wrapped = wrap_lines(" ".join(tokens), lines, max_chars)
        # Mapeo de cada token a su línea para respetar los saltos.
        line_of: list[int] = []
        for li, line in enumerate(wrapped):
            line_of.extend([li] * len(line.split()))
        for k, w in enumerate(words):
            start = w["s"]
            end = words[k + 1]["s"] if k + 1 < len(words) else cue["e"]
            if end <= start:
                end = start + 0.05
            parts: list[str] = []
            current_line = 0
            for j, tok in enumerate(tokens):
                lj = line_of[j] if j < len(line_of) else current_line
                if lj != current_line:
                    parts.append("\\N")
                    current_line = lj
                elif j > 0:
                    parts.append(" ")
                if j == k:
                    parts.append(f"{{\\c{hl_color}}}{_escape(tok)}{{\\c{base_color}}}")
                else:
                    parts.append(_escape(tok))
            events.append(f"Dialogue: 0,{_fmt_time(start)},{_fmt_time(end)},Sub,,0,0,0,,{soft}{''.join(parts)}")

    return "\n".join(header + events) + "\n"


def write_ass(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path
