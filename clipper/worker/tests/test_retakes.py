from clipper_worker.retakes import detect_retakes
from clipper_worker.sentences import build_sentences


def sents(*items):
    out, t = [], 0.0
    for text in items:
        n = len(text.split())
        out.append({"i": len(out), "s": t, "e": t + n * 0.4, "spk": 0, "text": text})
        t += n * 0.4 + 0.5
    return out


def test_false_start_repeated_next_sentence():
    s = sents("y para los que todos los que lo quier",
              "y les cuento el dato más importante para todos los que lo quieran conseguir en Argentina.",
              "Tremendo.")
    r = detect_retakes(s)
    assert [x["start_sentence"] for x in r] == [0]


def test_stutter_restart():
    s = sents("Las marcas nicho ya no", "Las marcas nicho ya no son nicho, las compraron corporaciones.")
    assert [x["start_sentence"] for x in detect_retakes(s)] == [0]


def test_no_false_positive_on_normal_speech():
    s = sents("Hoy quiero hablar de un tema que me tiene enojado.",
              "Los reseñadores de perfumes no son honestos, y eso lo sabemos todos.",
              "Bien.", "Ahora, el otro tema.")
    assert detect_retakes(s) == []


def test_gap_too_long_is_not_a_retake():
    s = sents("me encanta este perfume", "me encanta este perfume de verdad, lo uso siempre.")
    s[1]["s"] += 10; s[1]["e"] += 10
    assert detect_retakes(s) == []
