"""Selección de momentos con Claude.

Recibe la transcripción completa dividida en oraciones numeradas y devuelve
entre MIN y MAX candidatos. Claude elige índices de oración (así el clip
siempre empieza y termina en límite de oración); después se saltean
muletillas al inicio y se validan las duraciones.
"""
from __future__ import annotations

from typing import List

import anthropic
from pydantic import BaseModel, Field

from .config import config
from .errors import RetryableError, UserError
from .log import get_logger
from .sentences import sentences_for_prompt, strip_leading_fillers

log = get_logger(__name__)


class Candidate(BaseModel):
    start_sentence: int = Field(description="Índice de la oración con la que arranca el clip")
    end_sentence: int = Field(description="Índice de la última oración del clip (inclusive)")
    title: str = Field(description="Título propuesto, corto (máx. 60 caracteres)")
    hook: str = Field(description="La frase de apertura textual del clip")
    score: int = Field(ge=1, le=10, description="Puntaje 1-10 de potencial viral")
    reason: str = Field(description="Una línea: por qué es jugoso")


class Selection(BaseModel):
    candidates: List[Candidate]


SYSTEM_PROMPT = """Sos un editor senior de contenido en español rioplatense. Tu trabajo es encontrar, dentro de la transcripción de un video largo (charla, vivo, entrevista), los momentos que mejor funcionan como clips verticales cortos para Instagram Reels, TikTok y YouTube Shorts.

Recibís la transcripción dividida en oraciones numeradas con su timestamp y, cuando se detectó, el hablante (H0, H1...). Elegís clips indicando la oración de inicio y la de fin (inclusive).

Reglas de selección:
- Devolvé entre {min_n} y {max_n} candidatos. Si el material da para más, priorizá calidad y variedad temática (no repitas el mismo momento con distintos recortes). Si el material no da para {min_n} clips completos, devolvé menos: un clip cortado a la mitad no sirve.
- Cada clip es una unidad completa con principio, desarrollo y fin: plantea un tema o pregunta, lo desarrolla y lo cierra. Nunca cortes una idea a la mitad ni dejes un argumento colgado. Si una idea completa no entra en la duración máxima, descartala en lugar de recortarla.
- Duración objetivo de cada clip: entre {min_s} y {max_s} segundos. Podés pasarte hasta un 25% si hace falta para cerrar la idea, pero no más.
- Si el video entero dura menos que la duración máxima (más el 25%), lo mejor suele ser un solo clip con todo el video, arrancando en su primera frase fuerte.
- El clip TIENE que arrancar en una frase fuerte, que enganche sola, sin contexto previo. Nunca en muletillas ("bueno, eh", "o sea", "digamos", "a ver", "entonces") ni en respuestas que solo se entienden con la pregunta anterior. Si la frase fuerte está en la mitad de una oración larga, elegí la oración siguiente que arranque bien.
- El clip tiene que terminar en un cierre de idea, nunca a mitad de una frase.
- Preferí momentos con contradicción, dato concreto, opinión firme, anécdota, o una afirmación polémica bien argumentada. Evitá saludos, avisos, agradecimientos, lectura de comentarios sin contenido y explicaciones técnicas del stream.
- Si el usuario indica temas a buscar, priorizá los momentos sobre esos temas, pero no inventes relevancia: si no hay nada bueno sobre un tema, no lo fuerces.
- El título es corto (máximo 60 caracteres), en español rioplatense, sin emojis, sin clickbait vacío; tiene que decir de qué va el clip.
- El hook es la frase de apertura textual del clip (la primera oración tal cual aparece en la transcripción, o su primera parte).
- El puntaje va de 1 a 10 y refleja cuán probable es que el clip funcione solo, sin contexto.
- La razón es una sola línea concreta (qué tiene de jugoso).
- Los índices tienen que existir en la transcripción y start_sentence <= end_sentence."""


MAX_OVER = 1.25   # tolerancia por encima del máximo para cerrar la idea
MIN_UNDER = 0.8   # tolerancia por debajo del mínimo


def _duration_ok(d: float, min_s: float, max_s: float) -> bool:
    return (min_s * MIN_UNDER) <= d <= (max_s * MAX_OVER)


def select_moments(
    sentences: list[dict],
    words: list[dict],
    *,
    min_s: float,
    max_s: float,
    topics: str | None,
) -> list[dict]:
    if not sentences:
        raise UserError("La transcripción quedó vacía; no hay oraciones para analizar.")
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, max_retries=3)
    system = SYSTEM_PROMPT.format(
        min_n=config.MIN_CANDIDATES, max_n=config.MAX_CANDIDATES, min_s=int(min_s), max_s=int(max_s)
    )
    user_parts = []
    if topics and topics.strip():
        user_parts.append(f"Temas a buscar (prioridad del usuario): {topics.strip()}")
    user_parts.append(
        f"Duración objetivo: {int(min_s)}-{int(max_s)} segundos. Cantidad: entre {config.MIN_CANDIDATES} y {config.MAX_CANDIDATES} candidatos."
    )
    user_parts.append("Transcripción (una oración por línea: [índice] h:mm:ss hablante: texto):\n\n" + sentences_for_prompt(sentences))
    user_text = "\n\n".join(user_parts)

    try:
        response = client.messages.parse(
            model=config.CLAUDE_MODEL,
            max_tokens=16000,
            system=system,
            thinking={"type": "adaptive"},
            output_config={"effort": config.CLAUDE_EFFORT},
            messages=[{"role": "user", "content": user_text}],
            output_format=Selection,
        )
    except anthropic.AuthenticationError as e:
        raise UserError("Claude rechazó la API key (ANTHROPIC_API_KEY).") from e
    except anthropic.BadRequestError as e:
        raise UserError(f"Claude rechazó el pedido: {e.message}") from e
    except anthropic.RateLimitError as e:
        raise RetryableError("Claude: límite de uso alcanzado, se reintenta.") from e
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            raise RetryableError(f"Claude respondió {e.status_code}") from e
        raise UserError(f"Claude respondió {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise RetryableError("No se pudo conectar con Claude.") from e

    if response.stop_reason == "refusal":
        raise UserError("Claude no quiso analizar esta transcripción (rechazo por políticas de contenido).")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise RetryableError("La respuesta de Claude quedó incompleta.")

    return postprocess(response.parsed_output.candidates, sentences, words, min_s=min_s, max_s=max_s)


def postprocess(
    candidates: list[Candidate],
    sentences: list[dict],
    words: list[dict],
    *,
    min_s: float,
    max_s: float,
) -> list[dict]:
    n = len(sentences)
    results: list[dict] = []
    for c in candidates:
        a, b = c.start_sentence, c.end_sentence
        if not (0 <= a < n and 0 <= b < n and a <= b):
            continue
        wi = strip_leading_fillers(words, sentences[a]["wi"], sentences[b]["wj"])
        start = words[wi]["s"]
        end = sentences[b]["e"]
        # Un clip largo no se recorta (cortaría la idea a la mitad): se descarta.
        if (end - start) > max_s * MAX_OVER:
            log.info("candidato '%s' descartado: %.0f s supera el máximo", c.title, end - start)
            continue
        # Si quedó corto, extendemos hasta 2 oraciones hacia adelante para completar el cierre.
        extended = 0
        while b + 1 < n and extended < 2 and (end - start) < min_s * MIN_UNDER and (sentences[b + 1]["e"] - start) <= max_s * MAX_OVER:
            b += 1
            extended += 1
            end = sentences[b]["e"]
        dur = end - start
        if not _duration_ok(dur, min_s, max_s):
            log.info("candidato '%s' descartado: %.0f s fuera de rango", c.title, dur)
            continue
        # Un respiro chico antes del corte para no arrancar pegado a la primera palabra.
        start = max(0.0, start - 0.15)
        end = end + 0.35
        results.append({
            "start_s": round(start, 2),
            "end_s": round(end, 2),
            "title": c.title.strip()[:80],
            "hook": c.hook.strip()[:300],
            "score": int(c.score),
            "reason": c.reason.strip()[:300],
        })

    # Quitar solapamientos grandes (nos quedamos con el de mayor puntaje).
    results.sort(key=lambda r: -r["score"])
    kept: list[dict] = []
    for r in results:
        overlap = False
        for k in kept:
            inter = min(r["end_s"], k["end_s"]) - max(r["start_s"], k["start_s"])
            shorter = min(r["end_s"] - r["start_s"], k["end_s"] - k["start_s"])
            if inter > 0 and shorter > 0 and inter / shorter > 0.5:
                overlap = True
                break
        if not overlap:
            kept.append(r)
    return kept[: config.MAX_CANDIDATES]
