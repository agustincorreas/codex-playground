from clipper_worker.media import cut_points, keep_ranges_from_words, remap_time


def test_keep_ranges_and_remap():
    words = [{"s": 0.2, "e": 0.5}, {"s": 0.6, "e": 0.9}, {"s": 2.5, "e": 2.8}, {"s": 2.9, "e": 3.2}, {"s": 5.0, "e": 5.3}]
    ranges = keep_ranges_from_words(words, 6.0, min_pause_s=0.7, keep_pause_s=0.2, word_pad_s=0.0)
    # dos pausas largas (0.9→2.5 y 3.2→5.0) se recortan dejando 0.1 s a cada lado
    assert ranges == [(0.0, 1.0), (2.4, 3.3), (4.9, 6.0)]
    assert remap_time(0.5, ranges) == 0.5
    assert abs(remap_time(2.5, ranges) - 1.1) < 1e-9
    assert abs(remap_time(5.0, ranges) - 2.0) < 1e-9
    assert abs(remap_time(1.5, ranges) - 1.0) < 1e-9   # dentro de una pausa: pega al corte
    assert cut_points(ranges) == [1.0, 1.9]


def test_envelope_protects_words():
    """Si el audio muestra voz dentro de la 'pausa' (tiempos de palabras imprecisos),
    el corte se achica al tramo realmente silencioso o no se hace."""
    import numpy as np
    frame = 0.02
    rms = np.full(int(6.0 / frame), 0.001, dtype=np.float32)   # silencio
    rms[int(0.0 / frame):int(1.3 / frame)] = 0.2                # voz hasta 1.3 s (la palabra "termina" a 0.9 según el texto)
    rms[int(2.5 / frame):int(3.2 / frame)] = 0.2
    rms[int(5.0 / frame):int(5.3 / frame)] = 0.2
    words = [{"s": 0.2, "e": 0.9}, {"s": 2.5, "e": 3.2}, {"s": 5.0, "e": 5.3}]
    ranges = keep_ranges_from_words(words, 6.0, 0.7, 0.2, envelope=(rms, frame), word_pad_s=0.0)
    # el primer corte arranca después de 1.3 s (donde de verdad termina la voz), no en 0.9
    assert ranges[0][1] >= 1.3
    assert len(ranges) == 3


def test_no_cuts_when_pauses_short():
    words = [{"s": 0.2, "e": 0.5}, {"s": 0.8, "e": 1.1}]
    assert keep_ranges_from_words(words, 2.0, 0.7, 0.2) == [(0.0, 2.0)]
