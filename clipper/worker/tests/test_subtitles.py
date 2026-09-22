from clipper_worker.presets import BUILTIN_PRESETS, normalize
from clipper_worker.subtitles import apply_edits, build_ass, build_cues, wrap_lines


def words_from_text(text, start=10.0, step=0.4):
    out = []
    t = start
    for tok in text.split():
        out.append({"t": tok, "s": round(t, 2), "e": round(t + step * 0.9, 2), "spk": 0})
        t += step
    return out


def test_build_cues_respects_max_chars_and_relative_times():
    words = words_from_text("Los reseñadores de perfumes no son honestos. Muchas marcas nicho fueron compradas por corporaciones.")
    preset = BUILTIN_PRESETS["natural"]
    cues = build_cues(words, 10.0, 30.0, preset)
    assert cues[0]["s"] == 0.0
    limit = preset["subtitles"]["max_chars_per_line"] * preset["subtitles"]["lines"]
    for c in cues:
        assert len(c["text"]) <= limit + 12  # tolerancia por la última palabra
        assert c["e"] > c["s"]
    # los cues se encadenan sin huecos cortos
    for a, b in zip(cues, cues[1:]):
        assert a["e"] == b["s"]


def test_apply_edits_keeps_timing_when_word_count_matches():
    words = words_from_text("uno dos tres cuatro")
    cues = build_cues(words, 10.0, 12.0, BUILTIN_PRESETS["natural"])
    key = str(int(round(cues[0]["s"] * 1000)))
    edited = apply_edits(cues, {key: "Uno, dos, tres, cuatro"})
    assert edited[0]["text"] == "Uno, dos, tres, cuatro"
    assert [w["s"] for w in edited[0]["words"]] == [w["s"] for w in cues[0]["words"]]
    edited2 = apply_edits(cues, {key: "solo tres palabras"})
    assert len(edited2[0]["words"]) == 3


def test_wrap_lines_balances():
    lines = wrap_lines("una frase bastante larga para partir en dos líneas", 2, 26)
    assert len(lines) == 2
    assert all(len(l) <= 40 for l in lines)


def test_build_ass_natural_has_no_highlight_and_no_title():
    words = words_from_text("hola mundo esto es una prueba.")
    preset = BUILTIN_PRESETS["natural"]
    cues = build_cues(words, 10.0, 14.0, preset)
    ass = build_ass(cues, preset, "Un título", 4.0)
    assert "Style: Sub,Inter,62" in ass
    assert "Title,,0,0,0,," not in ass  # sin título en Natural
    assert "\\c&H" not in ass          # sin resaltado
    assert "Dialogue: 0," in ass


def test_build_ass_editorial_title_3s_and_dynamic_highlight():
    words = words_from_text("hola mundo esto es una prueba.")
    editorial = BUILTIN_PRESETS["editorial"]
    ass = build_ass(build_cues(words, 10.0, 14.0, editorial), editorial, "Título de dos líneas bien largo", 40.0)
    assert "Dialogue: 1,0:00:00.00,0:00:03.00,Title" in ass
    assert "Liberation Serif" in ass
    dinamico = BUILTIN_PRESETS["dinamico"]
    ass = build_ass(build_cues(words, 10.0, 14.0, dinamico), dinamico, "Título", 40.0)
    assert "Dialogue: 1,0:00:00.00,0:00:40.00,Title" in ass  # permanente
    assert ass.count("\\c&H00D4FF&") >= 6  # una palabra activa por evento


def test_normalize_partial_preset():
    cfg = normalize({"name": "Mío", "subtitles": {"size": 80}})
    assert cfg["subtitles"]["size"] == 80
    assert cfg["subtitles"]["font"] == "Inter"
    assert cfg["safe_area"]["bottom"] == 420
