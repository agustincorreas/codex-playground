"""Detección automática de falsos comienzos y repeticiones en la transcripción.

Complementa la revisión de Claude con una regla determinista: si una oración
corta queda seguida enseguida por otra que repite la mayoría de sus palabras
(el hablante se trabó y la volvió a decir), la primera es un falso comienzo y
se corta. También el caso de "tartamudeo": el final de una oración es igual al
principio de la siguiente.
"""
from __future__ import annotations

import re

MAX_GAP_S = 3.0        # separación máxima entre el intento fallido y la versión buena
MAX_TOKENS = 14        # un falso comienzo es corto
MIN_TOKENS = 2
MIN_OVERLAP = 0.6      # proporción de palabras del intento que reaparecen en la buena
STEM = 4               # letras para considerar dos palabras "la misma" (quier ~ quieran)


def _tokens(text: str) -> list[str]:
    out = []
    for tok in text.lower().split():
        t = re.sub(r"[^\wáéíóúüñ]", "", tok)
        if len(t) >= 2:
            out.append(t)
    return out


def _same(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= STEM and len(b) >= STEM and a[:STEM] == b[:STEM]:
        return True
    return False


def _overlap(short: list[str], long: list[str]) -> float:
    """Proporción de palabras de `short` que aparecen (en orden) en `long`."""
    if not short:
        return 0.0
    j = 0
    matched = 0
    for tok in short:
        k = j
        while k < len(long) and not _same(tok, long[k]):
            k += 1
        if k < len(long):
            matched += 1
            j = k + 1
    return matched / len(short)


def _stutter(prev: list[str], nxt: list[str]) -> int:
    """Largo del sufijo de prev que coincide con el prefijo de nxt (>= 3 palabras)."""
    best = 0
    for n in range(3, min(len(prev), len(nxt)) + 1):
        if all(_same(a, b) for a, b in zip(prev[-n:], nxt[:n])):
            best = n
    return best


def detect_retakes(sentences: list[dict]) -> list[dict]:
    """Devuelve [{"start_sentence", "end_sentence", "reason"}] con los tramos a cortar."""
    found: list[dict] = []
    n = len(sentences)
    for i in range(n - 1):
        cur = sentences[i]
        cur_t = _tokens(cur["text"])
        if not (MIN_TOKENS <= len(cur_t) <= MAX_TOKENS):
            continue
        for j in (i + 1, i + 2):
            if j >= n:
                break
            nxt = sentences[j]
            if nxt["s"] - cur["e"] > MAX_GAP_S:
                break
            nxt_t = _tokens(nxt["text"])
            if len(nxt_t) < len(cur_t):
                continue
            ratio = _overlap(cur_t, nxt_t)
            unfinished = not re.search(r"[.?!…]$", cur["text"].strip())
            if ratio >= MIN_OVERLAP and (unfinished or len(nxt_t) >= len(cur_t) + 2):
                found.append({"start_sentence": i, "end_sentence": i,
                              "reason": f"falso comienzo: se repite en la oración {j} ({ratio:.0%} de las palabras)"})
                break
            st = _stutter(cur_t, nxt_t)
            if st >= 3 and unfinished:
                found.append({"start_sentence": i, "end_sentence": i,
                              "reason": f"arranque repetido: las últimas {st} palabras se vuelven a decir en la oración {j}"})
                break
    return found
