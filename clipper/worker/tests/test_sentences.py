from clipper_worker.sentences import build_sentences, sentences_for_prompt, strip_leading_fillers


def make_words(spec):
    """spec: lista de (texto, inicio, fin, hablante)"""
    return [{"t": t, "s": s, "e": e, "spk": spk} for (t, s, e, spk) in spec]


def test_split_by_punctuation_and_pause():
    words = make_words([
        ("Hola,", 0.0, 0.3, 0), ("¿cómo", 0.3, 0.6, 0), ("estás?", 0.6, 1.0, 0),
        ("Bien.", 1.2, 1.5, 0),
        ("Ahora", 3.0, 3.3, 0), ("sigo", 3.3, 3.6, 0),
    ])
    sents = build_sentences(words)
    assert [s["text"] for s in sents] == ["Hola, ¿cómo estás?", "Bien.", "Ahora sigo"]
    assert sents[0]["wi"] == 0 and sents[0]["wj"] == 3
    assert sents[2]["s"] == 3.0 and sents[2]["e"] == 3.6


def test_split_on_speaker_change():
    words = make_words([("Yo", 0, 0.2, 0), ("digo", 0.2, 0.4, 0), ("No", 0.5, 0.7, 1), ("estoy", 0.7, 0.9, 1)])
    sents = build_sentences(words)
    assert len(sents) == 2 and sents[1]["spk"] == 1


def test_strip_leading_fillers():
    words = make_words([
        ("Bueno,", 0, 0.2, 0), ("eh,", 0.2, 0.4, 0), ("o", 0.4, 0.5, 0), ("sea,", 0.5, 0.7, 0),
        ("los", 0.7, 0.9, 0), ("reseñadores", 0.9, 1.4, 0), ("mienten.", 1.4, 1.9, 0), ("Punto.", 2.0, 2.3, 0),
    ])
    i = strip_leading_fillers(words, 0, len(words))
    assert words[i]["t"] == "los"


def test_prompt_format():
    words = make_words([("Hola.", 65.0, 65.5, 1)])
    text = sentences_for_prompt(build_sentences(words))
    assert text == "[0] 0:01:05 H1: Hola."
