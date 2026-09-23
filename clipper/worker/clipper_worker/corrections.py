"""Revisión de la transcripción: palabras reales y nombres bien escritos.

Los modelos de voz fallan seguido con materias primas (oud, vetiver, ámbar...),
marcas y nombres de perfumes. Claude revisa la transcripción con un glosario
(el de fábrica más el del usuario) y, para los nombres dudosos, puede buscar en
Fragrantica y Wikipedia. Devuelve reemplazos de frases; se aplican sobre las
palabras conservando los tiempos.
"""
from __future__ import annotations

import json
import re

import anthropic

from . import db
from .config import config
from .errors import RetryableError
from .log import get_logger
from .sentences import build_sentences, sentences_for_prompt

log = get_logger(__name__)

# Glosario de fábrica: materias primas, marcas y perfumes que suelen transcribirse mal.
BUILTIN_GLOSSARY = [
    # materias primas
    "oud", "agarwood", "ámbar", "ambroxan", "ambrette", "almizcle", "musk", "bergamota", "vetiver",
    "pachulí", "sándalo", "cedro", "iris", "orris", "incienso", "olíbano", "mirra", "benjuí",
    "labdanum", "tonka", "haba tonka", "vainilla", "cuero", "tabaco", "azafrán", "cardamomo",
    "pimienta rosa", "pimienta negra", "jengibre", "nardo", "tuberosa", "jazmín", "ylang ylang",
    "neroli", "azahar", "petitgrain", "lavanda", "geranio", "rosa de Damasco", "rosa taif",
    "iso e super", "hedione", "cashmeran", "calone", "aldehídos", "galbano", "vetiver de Haití",
    "cypriol", "nagarmotha", "ládano", "ciprés", "enebro", "mandarina", "pomelo", "yuzu",
    "higo", "coco", "ananá", "piña", "mango", "durazno", "pera", "manzana", "cassis", "frambuesa",
    "caramelo", "praliné", "café", "chocolate", "miel", "almendra", "pistacho", "leche",
    "concentración", "eau de toilette", "eau de parfum", "extrait de parfum", "parfum", "cologne",
    "proyección", "estela", "sillage", "longevidad", "salida", "corazón", "fondo", "notas de fondo",
    "dry down", "secado", "batch", "reformulación", "flanker", "decant", "nicho", "diseñador",
    # marcas
    "Creed", "Xerjoff", "Parfums de Marly", "Byredo", "Le Labo", "Tom Ford", "Maison Francis Kurkdjian",
    "MFK", "Amouage", "Nishane", "Initio", "Mancera", "Montale", "Lattafa", "Armaf", "Afnan", "Rasasi",
    "Dior", "Chanel", "Guerlain", "Yves Saint Laurent", "YSL", "Prada", "Givenchy", "Hermès", "Versace",
    "Paco Rabanne", "Rabanne", "Jean Paul Gaultier", "Carolina Herrera", "Dolce & Gabbana", "Armani",
    "Giorgio Armani", "Bvlgari", "Bulgari", "Valentino", "Viktor & Rolf", "Mugler", "Azzaro", "Lancôme",
    "Narciso Rodriguez", "Kilian", "By Kilian", "Frédéric Malle", "Diptyque", "Penhaligon's", "Roja",
    "Roja Dove", "Clive Christian", "Tiziana Terenzi", "Orto Parisi", "Nasomatto", "Memo", "Serge Lutens",
    "Comme des Garçons", "Escentric Molecules", "Juliette Has a Gun", "Zadig & Voltaire", "Mercedes-Benz",
    "Fueguia", "Fueguia 1833", "Puig", "Estée Lauder", "Kering", "LVMH", "Coty", "Interparfums",
    "Fragrantica", "Parfumo", "Basenotes",
    # perfumes
    "Aventus", "Green Irish Tweed", "Silver Mountain Water", "Baccarat Rouge 540", "Grand Soir",
    "Oud Satin Mood", "Layton", "Herod", "Pegasus", "Althaïr", "Greenley", "Percival", "Sedley",
    "Erba Pura", "Naxos", "Nio", "Alexandria II", "Renaissance", "Interlude", "Reflection Man",
    "Hacivat", "Ani", "Wulong Cha", "Side Effect", "Oud for Greatness", "Cedrat Boise", "Red Tobacco",
    "Instant Crush", "Aoud Lime", "Khamrah", "Asad", "Yara", "Club de Nuit Intense Man",
    "Sauvage", "Sauvage Elixir", "Dior Homme", "Fahrenheit", "Bleu de Chanel", "Allure Homme Sport",
    "Coco Mademoiselle", "Chance", "Terre d'Hermès", "Le Male", "Ultra Male", "Scandal", "Invictus",
    "1 Million", "Phantom", "Stronger With You", "Acqua di Giò", "Profumo", "Code", "Y", "La Nuit de l'Homme",
    "Libre", "Black Opium", "Good Girl", "212", "Bad Boy", "Eros", "Dylan Blue", "The One", "Light Blue",
    "Luna Rossa", "L'Homme", "Tobacco Vanille", "Oud Wood", "Ombré Leather", "Lost Cherry", "Black Orchid",
    "Fucking Fabulous", "Santal 33", "Another 13", "Bal d'Afrique", "Gypsy Water", "Mojave Ghost",
    "Molecule 01", "Angel", "Alien", "Aventus for Her", "Delina", "Oriana", "Valaya", "Kirke", "Ganymede",
    "Summer Hammer", "Mefisto",
]

SYSTEM_PROMPT = """Sos corrector de transcripciones de videos en español rioplatense sobre perfumes. Recibís la transcripción automática (con errores de oído) dividida en oraciones numeradas, y un glosario de materias primas, marcas y nombres de perfumes.

Tu trabajo: detectar las palabras o frases que quedaron mal transcriptas y proponer el texto correcto. Enfocate en:
- Nombres propios: marcas, perfumes, perfumistas, tiendas, ciudades.
- Materias primas y términos de perfumería (oud, vetiver, ámbar, ambroxan, extrait, sillage...).
- Palabras que no existen o no tienen sentido en contexto ("termendo" → "tremendo", "el red" → "Creed").
- Números y cifras mal transcriptos.

Además, marcá los tramos que un editor cortaría sí o sí:
- Falsos comienzos y repeticiones: el hablante arranca una frase, se traba o se equivoca y la vuelve a decir (se corta la primera versión, se deja la buena).
- Tramos sin contenido: solo muletillas ("eh", "este", "bueno"), pruebas de audio, "¿se escucha?", pedidos de que esperen, o silencio con ruido.
Cada tramo se indica por número de oración (inicio y fin, inclusive). No marques frases con contenido aunque sean flojas.

Reglas:
- Usá el glosario como referencia principal. Si un nombre no está en el glosario y no estás seguro, buscalo (Fragrantica y Wikipedia) antes de proponerlo; si igual no lo podés confirmar, no lo inventes: dejalo como está.
- No cambies el estilo ni la gramática del hablante: solo lo que está mal transcripto. Nada de reescribir frases enteras.
- Cada reemplazo tiene que ser una frase corta EXACTA de la transcripción ("from") y su corrección ("to"), para poder aplicarla sobre las palabras. Preferí reemplazos de 1 a 4 palabras.
- Respondé únicamente con un bloque JSON con esta forma:
  {"replacements": [{"from": "texto tal cual", "to": "texto corregido", "reason": "breve"}],
   "remove": [{"start_sentence": 0, "end_sentence": 0, "reason": "falso comienzo, la repite en la 1"}]}
  Si no hay nada que corregir ni cortar, las listas van vacías."""


def _glossary() -> list[str]:
    terms = list(BUILTIN_GLOSSARY)
    try:
        user = db.get_setting("glossary")
    except Exception:  # sin base (tests)
        user = None
    if isinstance(user, str):
        terms = [t.strip() for t in re.split(r"[\n,;]+", user) if t.strip()] + terms
    elif isinstance(user, list):
        terms = [str(t) for t in user] + terms
    seen, out = set(), []
    for t in terms:
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def _clean(tok: str) -> str:
    return re.sub(r"^[^\wáéíóúüñ]+|[^\wáéíóúüñ]+$", "", tok.lower())


def apply_replacements(words: list[dict], replacements: list[dict]) -> int:
    """Aplica reemplazos de frases sobre la lista de palabras, conservando los
    tiempos (si cambia la cantidad de palabras, se reparten en el mismo lapso).
    Devuelve cuántos reemplazos se aplicaron."""
    applied = 0
    for rep in replacements:
        src = [_clean(t) for t in str(rep.get("from", "")).split() if _clean(t)]
        dst_tokens = str(rep.get("to", "")).split()
        if not src or not dst_tokens or src == [_clean(t) for t in dst_tokens]:
            continue
        i = 0
        n = len(src)
        while i + n <= len(words):
            window = [_clean(w["t"]) for w in words[i:i + n]]
            if window == src:
                first, last = words[i], words[i + n - 1]
                # Conservamos la puntuación final de la frase original.
                trailing = re.search(r"[^\wáéíóúüñ]+$", last["t"])
                leading = re.search(r"^[^\wáéíóúüñ]+", first["t"])
                new_tokens = list(dst_tokens)
                if trailing and not re.search(r"[^\wáéíóúüñ]$", new_tokens[-1]):
                    new_tokens[-1] += trailing.group(0)
                if leading:
                    new_tokens[0] = leading.group(0) + new_tokens[0]
                span_s, span_e = first["s"], last["e"]
                spk = first.get("spk")
                if len(new_tokens) == n:
                    new_words = [dict(w, t=tok) for w, tok in zip(words[i:i + n], new_tokens)]
                else:
                    step = max(0.05, (span_e - span_s) / len(new_tokens))
                    new_words = [
                        {"t": tok, "s": round(span_s + k * step, 3), "e": round(min(span_e, span_s + (k + 1) * step), 3), "spk": spk}
                        for k, tok in enumerate(new_tokens)
                    ]
                words[i:i + n] = new_words
                applied += 1
                i += len(new_tokens)
            else:
                i += 1
    return applied


def _parse_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def correct_transcript(words: list[dict], topics: str | None = None) -> dict:
    """Pide a Claude los reemplazos y los aplica in place. Devuelve un resumen."""
    if not config.CORRECT_TRANSCRIPT:
        return {"applied": 0, "replacements": []}
    sentences = build_sentences(words)
    glossary = _glossary()
    user_text = ""
    if topics:
        user_text += f"Temas del video según el usuario: {topics}\n\n"
    user_text += "Glosario (términos correctos): " + ", ".join(glossary) + "\n\n"
    user_text += "Transcripción:\n\n" + sentences_for_prompt(sentences)

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=3)
    tools = []
    if config.CORRECTION_WEB_SEARCH:
        tools.append({
            "type": "web_search_20260209",
            "name": "web_search",
            "max_uses": 8,
            "allowed_domains": ["fragrantica.com", "fragrantica.es", "parfumo.com", "wikipedia.org"],
        })
    try:
        response = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            tools=tools or anthropic.NOT_GIVEN,
            messages=[{"role": "user", "content": user_text}],
        )
    except anthropic.RateLimitError as e:
        raise RetryableError("Claude: límite de uso alcanzado (corrección).") from e
    except anthropic.APIConnectionError as e:
        raise RetryableError("No se pudo conectar con Claude (corrección).") from e
    except anthropic.APIStatusError as e:
        log.warning("corrección de transcripción omitida: %s", e.message)
        return {"applied": 0, "replacements": [], "error": e.message}
    if response.stop_reason == "refusal":
        return {"applied": 0, "replacements": []}
    text = "".join(b.text for b in response.content if b.type == "text")
    data = _parse_json(text) or {}
    reps = [r for r in data.get("replacements", []) if isinstance(r, dict)]
    applied = apply_replacements(words, reps)
    remove_ranges = removal_ranges(sentences, [r for r in data.get("remove", []) if isinstance(r, dict)])
    log.info("corrección de transcripción: %d reemplazos propuestos, %d aplicados, %d tramos a cortar",
             len(reps), applied, len(remove_ranges))
    return {"applied": applied, "replacements": reps, "remove_ranges": remove_ranges}


def removal_ranges(sentences: list[dict], items: list[dict]) -> list[list[float]]:
    """Convierte tramos por oración en rangos de tiempo absolutos [inicio, fin]."""
    out: list[list[float]] = []
    n = len(sentences)
    for it in items:
        try:
            a, b = int(it.get("start_sentence")), int(it.get("end_sentence", it.get("start_sentence")))
        except (TypeError, ValueError):
            continue
        if not (0 <= a < n and 0 <= b < n and a <= b):
            continue
        out.append([round(sentences[a]["s"] - 0.05, 3), round(sentences[b]["e"] + 0.05, 3)])
    return out


def drop_words_in_ranges(words: list[dict], ranges: list[list[float]]) -> list[dict]:
    """Palabras que quedan fuera de los tramos cortados."""
    if not ranges:
        return words
    def inside(w):
        mid = (w["s"] + w["e"]) / 2
        return any(a <= mid <= b for a, b in ranges)
    return [w for w in words if not inside(w)]
