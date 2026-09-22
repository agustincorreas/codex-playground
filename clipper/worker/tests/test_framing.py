from clipper_worker.framing import Analysis, Face, Track, build_plan, SAMPLE_FPS
from clipper_worker.presets import BUILTIN_PRESETS


def make_track(tid, cx, cy, n, activity):
    tr = Track(id=tid, last_face=Face(cx - 50, cy - 50, 100, 100), last_t=0.0, hits=n)
    tr.centers = {i: (cx, cy, 100.0) for i in range(n)}
    tr.activity = list(activity)
    return tr


def test_single_face_centered_crop():
    n = 50
    tr = make_track(0, 900.0, 300.0, n, [0.01] * n)
    an = Analysis(1280, 720, 30.0, 300, [i / SAMPLE_FPS for i in range(n)], [tr])
    plan = build_plan(an, BUILTIN_PRESETS["natural"])
    assert plan.mode == "single"
    x, y, w, h = plan.rects_at(5.0)[0]
    assert (w, h) == (405, 720)
    assert abs((x + w / 2) - 900) < 3


def test_switch_follows_active_mouth():
    n = 60
    left = make_track(0, 300.0, 360.0, n, [0.02] * 30 + [0.0] * 30)
    right = make_track(1, 980.0, 360.0, n, [0.0] * 30 + [0.02] * 30)
    an = Analysis(1280, 720, 30.0, 360, [i / SAMPLE_FPS for i in range(n)], [left, right])
    plan = build_plan(an, BUILTIN_PRESETS["natural"])
    x0, _, w, _ = plan.rects_at(2.0)[0]
    x1, _, _, _ = plan.rects_at(10.0)[0]
    assert abs(x0 + w / 2 - 300) < 40
    assert abs(x1 + w / 2 - 980) < 40
    assert any(k.cut for k in plan.keys)


def test_split_mode_two_panels():
    n = 40
    left = make_track(0, 300.0, 360.0, n, [0.01] * n)
    right = make_track(1, 980.0, 360.0, n, [0.01] * n)
    an = Analysis(1280, 720, 30.0, 240, [i / SAMPLE_FPS for i in range(n)], [left, right])
    preset = dict(BUILTIN_PRESETS["natural"], two_speakers="split")
    plan = build_plan(an, preset)
    assert plan.mode == "split"
    rects = plan.rects_at(3.0)
    assert len(rects) == 2 and rects[0][2] == 810 and rects[0][3] == 720


def test_no_faces_center_crop():
    an = Analysis(1280, 720, 30.0, 60, [i / SAMPLE_FPS for i in range(10)], [])
    plan = build_plan(an, BUILTIN_PRESETS["natural"])
    x, y, w, h = plan.rects_at(1.0)[0]
    assert (x, y, w, h) == (438, 0, 405, 720)


def test_dynamic_zoom_after_cut():
    n = 60
    left = make_track(0, 300.0, 360.0, n, [0.02] * 30 + [0.0] * 30)
    right = make_track(1, 980.0, 360.0, n, [0.0] * 30 + [0.02] * 30)
    an = Analysis(1280, 720, 30.0, 360, [i / SAMPLE_FPS for i in range(n)], [left, right])
    plan = build_plan(an, BUILTIN_PRESETS["dinamico"])
    cut_key = next(k for k in plan.keys if k.cut)
    assert cut_key.rects[0][2] < 405  # recorte más chico = zoom
