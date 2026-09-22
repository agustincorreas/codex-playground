"""Oraciones a partir de palabras con timestamps, y limpieza de muletillas."""
from __future__ import annotations

import re

SENTENCE_END = re.compile(r"[.?!…]+[\"”')]*$")
PAUSE_S = 0.8
MAX_WORDS = 45

# Muletillas/conectores con los que un clip no debería arrancar.
FILLERS = {
    "bueno", "bue", "eh", "ehh", "ehm", "em", "mm", "mmm", "este", "esto", "o", "sea", "digamos",
    "a", "ver", "nada", "dale", "ok", "okey", "okay", "aha", "ajá", "y", "entonces", "igual",
    "tipo", "viste", "che", "claro", "bien", "o sea", "a ver", "es decir", "eh...", "emm",
}
FILLER_PHRASES = ["o sea", "a ver", "es decir", "digamos que", "como te decía", "como decía"]


def _clean(token: str) -> str:
    return re.sub(r"^[^\wáéíóúüñ]+|[^\wáéíóúüñ]+$", "", token.lower())


def build_sentences(words: list[dict]) -> list[dict]:
    """Agrupa palabras en oraciones: por puntuación, pausas largas, cambio de
    hablante o largo máximo. Devuelve [{"i","s","e","spk","text","wi","wj"}]
    donde wi/wj son los índices (inclusive/exclusivo) en `words`."""
    sentences: list[dict] = []
    current: list[int] = []

    def flush(end_idx: int):
        if not current:
            return
        ws = [words[k] for k in current]
        sentences.append({
            "i": len(sentences),
            "s": ws[0]["s"],
            "e": ws[-1]["e"],
            "spk": ws[0].get("spk"),
            "text": " ".join(w["t"] for w in ws),
            "wi": current[0],
            "wj": end_idx,
        })
        current.clear()

    for idx, w in enumerate(words):
        if current:
            prev = words[current[-1]]
            speaker_changed = prev.get("spk") is not None and w.get("spk") is not None and prev["spk"] != w["spk"]
            if speaker_changed or (w["s"] - prev["e"]) > PAUSE_S:
                flush(idx)
        current.append(idx)
        if SENTENCE_END.search(w["t"]) or len(current) >= MAX_WORDS:
            flush(idx + 1)
    flush(len(words))
    return sentences


def strip_leading_fillers(words: list[dict], wi: int, wj: int) -> int:
    """Devuelve el nuevo índice inicial saltando muletillas al comienzo."""
    i = wi
    while i < wj - 3:
        tok = _clean(words[i]["t"])
        two = tok + " " + _clean(words[i + 1]["t"]) if i + 1 < wj else ""
        if two in FILLER_PHRASES:
            i += 2
            continue
        if tok in FILLERS or tok == "":
            i += 1
            continue
        break
    return i


def format_timestamp(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}"


def sentences_for_prompt(sentences: list[dict]) -> str:
    lines = []
    for s in sentences:
        spk = f" H{s['spk']}" if s.get("spk") is not None else ""
        lines.append(f"[{s['i']}] {format_timestamp(s['s'])}{spk}: {s['text']}")
    return "\n".join(lines)


def words_in_range(words: list[dict], start: float, end: float) -> list[dict]:
    return [w for w in words if w["e"] > start and w["s"] < end]
