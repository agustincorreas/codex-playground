from clipper_worker.select_moments import Candidate, postprocess
from clipper_worker.sentences import build_sentences


def make_transcript(n_sentences=40, words_per=8, word_dur=0.5):
    words = []
    t = 0.0
    for i in range(n_sentences):
        for j in range(words_per):
            tok = f"p{i}_{j}"
            if j == 0 and i % 3 == 0:
                tok = "Bueno,"
            if j == words_per - 1:
                tok += "."
            words.append({"t": tok, "s": round(t, 2), "e": round(t + word_dur * 0.9, 2), "spk": 0})
            t += word_dur
    return words


def test_postprocess_snaps_and_strips_fillers():
    words = make_transcript()
    sents = build_sentences(words)
    # cada oración dura 4 s; 15-30 oraciones = 60-120 s
    cands = [
        Candidate(start_sentence=0, end_sentence=19, title="A", hook="h", score=9, reason="r"),
        Candidate(start_sentence=2, end_sentence=21, title="B (solapado)", hook="h", score=7, reason="r"),
        Candidate(start_sentence=25, end_sentence=27, title="C (corto)", hook="h", score=8, reason="r"),
        Candidate(start_sentence=30, end_sentence=99, title="D (fuera)", hook="h", score=8, reason="r"),
    ]
    out = postprocess(cands, sents, words, min_s=60, max_s=120)
    titles = [c["title"] for c in out]
    assert "A" in titles and "B (solapado)" not in titles and "D (fuera)" not in titles
    a = next(c for c in out if c["title"] == "A")
    # la oración 0 arranca con "Bueno," -> el inicio salta esa palabra (menos un respiro de 0.15 s)
    assert abs(a["start_s"] - (words[1]["s"] - 0.15)) < 1e-6
    # "C" se extiende hacia adelante hasta entrar en rango
    c = next(c for c in out if c["title"] == "C (corto)")
    assert 60 * 0.85 <= c["end_s"] - c["start_s"] <= 120 * 1.15


def test_postprocess_trims_long():
    words = make_transcript(n_sentences=60)
    sents = build_sentences(words)
    out = postprocess([Candidate(start_sentence=0, end_sentence=50, title="L", hook="h", score=5, reason="r")],
                      sents, words, min_s=60, max_s=120)
    assert len(out) == 1
    assert out[0]["end_s"] - out[0]["start_s"] <= 120 * 1.15 + 0.5
