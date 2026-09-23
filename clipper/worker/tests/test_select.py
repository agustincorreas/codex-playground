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
    words = make_transcript(n_sentences=50)
    sents = build_sentences(words)
    # cada oración dura 4 s; 15-30 oraciones = 60-120 s
    cands = [
        Candidate(start_sentence=0, end_sentence=19, title="A", hook="h", score=9, reason="r"),
        Candidate(start_sentence=2, end_sentence=21, title="B (solapado)", hook="h", score=7, reason="r"),
        Candidate(start_sentence=25, end_sentence=27, title="C (muy corto)", hook="h", score=8, reason="r"),
        Candidate(start_sentence=28, end_sentence=38, title="E (casi corto)", hook="h", score=8, reason="r"),
        Candidate(start_sentence=30, end_sentence=99, title="D (fuera)", hook="h", score=8, reason="r"),
    ]
    out = postprocess(cands, sents, words, min_s=60, max_s=120)
    titles = [c["title"] for c in out]
    assert "A" in titles and "B (solapado)" not in titles and "D (fuera)" not in titles
    a = next(c for c in out if c["title"] == "A")
    # arranca a menos de 4 s del inicio del video: se toma el principio completo
    assert a["start_s"] == 0.0
    # en cambio, un clip que arranca en el medio salta la muletilla inicial ("Bueno,") menos un respiro de 0.15 s
    e = next(c for c in out if c["title"] == "E (casi corto)")
    assert abs(e["start_s"] - (words[28 * 8]["s"] - 0.15)) < 1e-6
    # "C" (12 s) es demasiado corto para completarse con 2 oraciones más: se descarta
    assert "C (muy corto)" not in titles
    # "E" (44 s) se extiende hasta 2 oraciones (52 s >= 48 s) y entra
    e = next(c for c in out if c["title"] == "E (casi corto)")
    assert 60 * 0.8 <= e["end_s"] - e["start_s"] <= 120 * 1.25


def test_postprocess_discards_long_instead_of_cutting():
    """Un clip que no entra en el máximo (+25%) se descarta: nunca se corta una idea a la mitad."""
    words = make_transcript(n_sentences=60)
    sents = build_sentences(words)
    out = postprocess([Candidate(start_sentence=0, end_sentence=50, title="L", hook="h", score=5, reason="r")],
                      sents, words, min_s=60, max_s=120)
    assert out == []
    # pero hasta un 25% por encima del máximo se acepta (36 oraciones = 144 s <= 150 s)
    out = postprocess([Candidate(start_sentence=0, end_sentence=35, title="L2", hook="h", score=5, reason="r")],
                      sents, words, min_s=60, max_s=120)
    assert len(out) == 1


def test_short_video_becomes_one_whole_clip_and_edges_snap():
    words = make_transcript(n_sentences=20)          # 80 s de video
    sents = build_sentences(words)
    cands = [Candidate(start_sentence=3, end_sentence=17, title="Recorte", hook="h", score=8, reason="r")]
    out = postprocess(cands, sents, words, min_s=60, max_s=150, video_duration=80.0)
    # el video entero (80 s <= 150) es el primer candidato, de 0 al final
    assert out[0]["start_s"] == 0.0 and out[0]["end_s"] == 80.0 and out[0]["score"] == 10
    # el recorte 3..17 (56 s) se solapa casi todo con el entero: se descarta
    assert len(out) == 1
    # si Claude propuso un candidato que cubre casi todo el video, se usa su título y pasa a ser el video entero
    out = postprocess([Candidate(start_sentence=1, end_sentence=19, title="Título de Claude", hook="h", score=8, reason="r")],
                      sents, words, min_s=60, max_s=150, video_duration=80.0)
    assert out[0]["title"] == "Título de Claude" and out[0]["start_s"] == 0.0 and out[0]["end_s"] == 80.0 and out[0]["score"] == 9
    # video largo: un clip que termina a menos de 4 s del final se extiende hasta el final
    words = make_transcript(n_sentences=60)          # 240 s
    sents = build_sentences(words)
    out = postprocess([Candidate(start_sentence=40, end_sentence=59, title="Final", hook="h", score=8, reason="r")],
                      sents, words, min_s=60, max_s=150, video_duration=240.0)
    assert out[0]["end_s"] == 240.0
