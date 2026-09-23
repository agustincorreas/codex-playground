from clipper_worker.corrections import apply_replacements, _glossary


def words_of(text, start=0.0):
    out, t = [], start
    for tok in text.split():
        out.append({"t": tok, "s": round(t, 2), "e": round(t + 0.3, 2), "spk": 0})
        t += 0.4
    return out


def test_apply_replacements_keeps_timing_and_punctuation():
    words = words_of("el tobacco anilla era el perfume más rendido del local.")
    n = apply_replacements(words, [
        {"from": "tobacco anilla", "to": "Tobacco Vanille"},
        {"from": "rendido", "to": "vendido"},
        {"from": "local.", "to": "local"},   # sin cambio real (solo puntuación): se ignora
    ])
    assert n == 2
    text = " ".join(w["t"] for w in words)
    assert text == "el Tobacco Vanille era el perfume más vendido del local."
    assert words[1]["s"] == 0.4 and words[2]["e"] == 1.1


def test_apply_replacements_different_word_count():
    words = words_of("compré un Samarhammer de pasaglia ayer.")
    n = apply_replacements(words, [{"from": "Samarhammer", "to": "Summer Hammer"}])
    assert n == 1
    assert [w["t"] for w in words][2:4] == ["Summer", "Hammer"]
    assert words[2]["s"] == 0.8 and words[3]["e"] <= 1.1
    assert words[4]["t"] == "de"


def test_glossary_has_builtin_terms():
    g = _glossary()
    assert "oud" in g and "Creed" in g and "Baccarat Rouge 540" in g


def test_removal_ranges_and_drop_words():
    from clipper_worker.corrections import drop_words_in_ranges, removal_ranges
    words = words_of("Hoy es invierno pero ga. Hoy estamos en invierno pero hace calor.")
    sents = [{"i": 0, "s": 0.0, "e": 1.9}, {"i": 1, "s": 2.0, "e": 4.7}]
    ranges = removal_ranges(sents, [{"start_sentence": 0, "end_sentence": 0, "reason": "falso comienzo"}, {"start_sentence": 7}])
    assert ranges == [[-0.05, 1.95]]
    kept = drop_words_in_ranges(words, ranges)
    assert kept[0]["t"] == "Hoy" and kept[0]["s"] == 2.0 and len(kept) == 7
