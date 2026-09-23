from clipper_worker.media import cut_points, keep_ranges_from_words, remap_time


def test_keep_ranges_and_remap():
    words = [{"s": 0.2, "e": 0.5}, {"s": 0.6, "e": 0.9}, {"s": 2.5, "e": 2.8}, {"s": 2.9, "e": 3.2}, {"s": 5.0, "e": 5.3}]
    ranges = keep_ranges_from_words(words, 6.0, min_pause_s=0.7, keep_pause_s=0.2)
    # dos pausas largas (0.9→2.5 y 3.2→5.0) se recortan dejando 0.1 s a cada lado
    assert ranges == [(0.0, 1.0), (2.4, 3.3), (4.9, 6.0)]
    assert remap_time(0.5, ranges) == 0.5
    assert abs(remap_time(2.5, ranges) - 1.1) < 1e-9
    assert abs(remap_time(5.0, ranges) - 2.0) < 1e-9
    assert abs(remap_time(1.5, ranges) - 1.0) < 1e-9   # dentro de una pausa: pega al corte
    assert cut_points(ranges) == [1.0, 1.9]


def test_no_cuts_when_pauses_short():
    words = [{"s": 0.2, "e": 0.5}, {"s": 0.8, "e": 1.1}]
    assert keep_ranges_from_words(words, 2.0, 0.7, 0.2) == [(0.0, 2.0)]
