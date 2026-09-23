"""Detección de video espejado (grabado con cámara frontal).

Se leen con OCR algunos cuadros del video, tal cual y dados vuelta; si el texto
se lee claramente mejor en la versión invertida (etiquetas, carteles, remeras),
el video está en espejo y hay que darlo vuelta para que se lea al derecho.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import cv2
import numpy as np

from .log import get_logger

log = get_logger(__name__)

SAMPLES = 10
MIN_WORD_LEN = 4
MIN_WORDS = 2         # palabras de diccionario mínimas para decidir
RATIO = 1.5           # cuánto mejor tiene que leerse invertido para decidir "espejado"
DICT_FILES = ["/usr/share/dict/spanish", "/usr/share/dict/american-english", "/usr/share/dict/words"]

_dictionary: set[str] | None = None


def _dictionary_words() -> set[str]:
    """Palabras reales (diccionarios del sistema + glosario de perfumería)."""
    global _dictionary
    if _dictionary is not None:
        return _dictionary
    words: set[str] = set()
    for f in DICT_FILES:
        try:
            with open(f, encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    w = line.strip().lower()
                    if len(w) >= MIN_WORD_LEN and w.isalpha():
                        words.add(w)
        except OSError:
            continue
    try:
        from .corrections import BUILTIN_GLOSSARY
        for term in BUILTIN_GLOSSARY:
            for tok in re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}", term):
                words.add(tok.lower())
    except Exception:  # noqa: BLE001
        pass
    if not words:
        words = {"summer", "hammer", "parfum", "extrait", "perfume", "eau", "toilette", "cologne", "edition", "limited"}
    _dictionary = words
    return words


def _known_word(t: str, dictionary: set[str], glossary_words: set[str]) -> bool:
    """Palabra de diccionario, o un trozo (>= 4 letras) de un término del glosario
    (etiquetas parciales: 'UMME' de SUMMER, 'HAMM' de HAMMER)."""
    low = t.lower()
    if low in dictionary:
        return True
    if len(low) >= 4:
        for g in glossary_words:
            if len(g) >= 5 and low in g:
                return True
    return False


def _glossary_words() -> set[str]:
    try:
        from .corrections import BUILTIN_GLOSSARY
    except Exception:  # noqa: BLE001
        return set()
    out: set[str] = set()
    for term in BUILTIN_GLOSSARY:
        for tok in re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}", term):
            out.add(tok.lower())
    return out


def _ocr_score(image_bgr: np.ndarray) -> tuple[float, list[str]]:
    """Suma de confianzas de las palabras reales leídas en la imagen, probando
    también rotada 90° (etiquetas en vertical, como un frasco en la mano)."""
    try:
        import pytesseract
    except ImportError:
        return 0.0, []
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    scale = 1.5 if w >= 720 else 1200 / w
    gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    dictionary = _dictionary_words()
    glossary = _glossary_words()
    score, words = 0.0, []
    for rot in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        img = gray if rot is None else cv2.rotate(gray, rot)
        try:
            data = pytesseract.image_to_data(img, lang="spa+eng", config="--psm 11", output_type=pytesseract.Output.DICT)
        except Exception as e:  # noqa: BLE001
            log.warning("OCR falló: %s", e)
            continue
        for text, conf in zip(data.get("text", []), data.get("conf", [])):
            try:
                c = float(conf)
            except (TypeError, ValueError):
                continue
            t = (text or "").strip()
            if c < 55 or len(t) < MIN_WORD_LEN or not re.fullmatch(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", t):
                continue
            if not _known_word(t, dictionary, glossary):
                continue
            score += c
            words.append(t)
    return score, words


def _sample_frames(source: Path, duration: float, n: int = SAMPLES) -> list[np.ndarray]:
    frames = []
    for k in range(n):
        t = duration * (0.08 + 0.84 * k / max(1, n - 1))
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(source), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True, timeout=120,
        )
        if proc.returncode == 0 and proc.stdout:
            arr = np.frombuffer(proc.stdout, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None:
                frames.append(img)
    return frames


def detect_mirrored(source: Path, duration: float) -> dict:
    """Devuelve {"mirrored": bool, "normal": score, "flipped": score, "words": [...]}."""
    normal = flipped = 0.0
    words_n: list[str] = []
    words_f: list[str] = []
    for img in _sample_frames(source, duration):
        s1, w1 = _ocr_score(img)
        s2, w2 = _ocr_score(cv2.flip(img, 1))
        normal += s1
        flipped += s2
        words_n += w1
        words_f += w2
    mirrored = len(words_f) >= MIN_WORDS and flipped > normal * RATIO
    log.info("espejo: normal=%.0f (%s) invertido=%.0f (%s) -> %s", normal, " ".join(words_n[:6]), flipped,
             " ".join(words_f[:6]), "ESPEJADO" if mirrored else "normal")
    return {"mirrored": mirrored, "normal": round(normal), "flipped": round(flipped),
            "words": (words_f if mirrored else words_n)[:12]}
