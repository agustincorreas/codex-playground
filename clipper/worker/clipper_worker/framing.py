"""Reencuadre vertical con seguimiento del hablante activo.

Se detectan rostros con OpenCV (YuNet; si falta el modelo, Haar cascade) a
~5 muestras por segundo, se arman "tracks" (una persona = un track) y se
estima quién habla midiendo el movimiento de la boca. Con eso se decide, para
cada instante, el rectángulo de recorte 9:16 (o dos rectángulos 9:8 en modo
dividido). Los movimientos se suavizan; los cambios de hablante son cortes
limpios (sin paneo).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .config import config
from .log import get_logger

log = get_logger(__name__)

SAMPLE_FPS = 5.0
DETECT_WIDTH = 640
TRACK_TIMEOUT_S = 1.5
ACTIVITY_WINDOW = 5          # muestras (~1 s)
SWITCH_MIN_DWELL_S = 1.5     # no cambiar de hablante más seguido que esto
SWITCH_CONFIRM_SAMPLES = 3   # muestras seguidas con el otro hablante más activo
ZOOM_EASE_S = 0.8


@dataclass
class Face:
    x: float
    y: float
    w: float
    h: float
    mouth: tuple[float, float, float, float] | None = None  # x, y, w, h de la boca

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@dataclass
class Track:
    id: int
    last_face: Face
    last_t: float
    hits: int = 0
    prev_mouth: np.ndarray | None = None
    activity: list[float] = field(default_factory=list)
    centers: dict[int, tuple[float, float, float]] = field(default_factory=dict)  # sample -> (cx, cy, h)

    def smoothed_activity(self) -> float:
        if not self.activity:
            return 0.0
        return float(sum(self.activity[-ACTIVITY_WINDOW:]))


class FaceDetector:
    def __init__(self, model_path: str | None = None):
        self.yunet = None
        self.haar = None
        path = model_path or config.FACE_MODEL_PATH
        if path and Path(path).exists() and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet = cv2.FaceDetectorYN.create(path, "", (DETECT_WIDTH, DETECT_WIDTH), 0.7, 0.3, 50)
                log.info("detección de rostros: YuNet (%s)", path)
            except cv2.error as e:  # pragma: no cover
                log.warning("no se pudo cargar YuNet: %s", e)
        if self.yunet is None:
            cascade = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
            self.haar = cv2.CascadeClassifier(str(cascade))
            log.info("detección de rostros: Haar cascade (fallback)")
        self._size: tuple[int, int] | None = None

    def detect(self, frame: np.ndarray) -> list[Face]:
        h, w = frame.shape[:2]
        scale = DETECT_WIDTH / float(w) if w > DETECT_WIDTH else 1.0
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
        sh, sw = small.shape[:2]
        faces: list[Face] = []
        if self.yunet is not None:
            if self._size != (sw, sh):
                self.yunet.setInputSize((sw, sh))
                self._size = (sw, sh)
            _, dets = self.yunet.detect(small)
            if dets is not None:
                for d in dets:
                    x, y, fw, fh = [float(v) / scale for v in d[:4]]
                    # landmarks: ojo der, ojo izq, nariz, comisura der, comisura izq
                    lm = [float(v) / scale for v in d[4:14]]
                    mx1, my1, mx2, my2 = lm[6], lm[7], lm[8], lm[9]
                    mw = max(abs(mx2 - mx1) * 1.4, fw * 0.3)
                    mh = max(fh * 0.22, 8.0)
                    mcx, mcy = (mx1 + mx2) / 2, (my1 + my2) / 2
                    faces.append(Face(x, y, fw, fh, (mcx - mw / 2, mcy - mh / 2, mw, mh)))
        else:
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            rects = self.haar.detectMultiScale(gray, 1.15, 5, minSize=(int(sw * 0.06), int(sw * 0.06)))
            for (x, y, fw, fh) in rects:
                x, y, fw, fh = x / scale, y / scale, fw / scale, fh / scale
                faces.append(Face(x, y, fw, fh, (x + fw * 0.25, y + fh * 0.65, fw * 0.5, fh * 0.25)))
        faces.sort(key=lambda f: -(f.w * f.h))
        return faces[:4]


def _mouth_patch(gray: np.ndarray, face: Face) -> np.ndarray | None:
    if not face.mouth:
        return None
    x, y, w, h = face.mouth
    H, W = gray.shape[:2]
    x0, y0 = int(max(0, x)), int(max(0, y))
    x1, y1 = int(min(W, x + w)), int(min(H, y + h))
    if x1 - x0 < 4 or y1 - y0 < 3:
        return None
    patch = gray[y0:y1, x0:x1]
    return cv2.resize(patch, (32, 16)).astype(np.float32)


@dataclass
class Analysis:
    width: int
    height: int
    fps: float
    n_frames: int
    sample_times: list[float]
    tracks: list[Track]


def analyze(segment: Path, *, detector: FaceDetector | None = None) -> Analysis:
    detector = detector or FaceDetector()
    cap = cv2.VideoCapture(str(segment))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV no pudo abrir {segment}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, int(round(fps / SAMPLE_FPS)))

    tracks: list[Track] = []
    next_id = 0
    sample_times: list[float] = []
    frame_idx = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if frame_idx % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            t = frame_idx / fps
            si = len(sample_times)
            sample_times.append(t)
            faces = detector.detect(frame)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # Asociación greedy rostro -> track por distancia de centros.
            unmatched = list(faces)
            for tr in sorted(tracks, key=lambda tr: -tr.hits):
                if t - tr.last_t > TRACK_TIMEOUT_S:
                    continue
                best, best_d = None, None
                for f in unmatched:
                    d = math.hypot(f.cx - tr.last_face.cx, f.cy - tr.last_face.cy)
                    if d < max(f.w, tr.last_face.w) * 0.8 and (best_d is None or d < best_d):
                        best, best_d = f, d
                if best is not None:
                    unmatched.remove(best)
                    _update_track(tr, best, t, si, gray)
            for f in unmatched:
                tr = Track(id=next_id, last_face=f, last_t=t)
                next_id += 1
                _update_track(tr, f, t, si, gray)
                tracks.append(tr)
            # Los tracks sin detección en esta muestra reciben actividad 0.
            for tr in tracks:
                if len(tr.activity) < len(sample_times):
                    tr.activity.append(0.0)
        frame_idx += 1
    cap.release()
    if n_frames <= 0:
        n_frames = frame_idx
    return Analysis(width, height, fps, n_frames, sample_times, tracks)


def _update_track(tr: Track, face: Face, t: float, si: int, gray: np.ndarray) -> None:
    patch = _mouth_patch(gray, face)
    act = 0.0
    if patch is not None and tr.prev_mouth is not None and tr.prev_mouth.shape == patch.shape:
        act = float(np.mean(np.abs(patch - tr.prev_mouth))) / 255.0
    tr.prev_mouth = patch
    tr.last_face = face
    tr.last_t = t
    tr.hits += 1
    tr.centers[si] = (face.cx, face.cy - face.h * 0.05, face.h)
    while len(tr.activity) < si:
        tr.activity.append(0.0)
    tr.activity.append(act)


@dataclass
class CropKey:
    t: float
    rects: list[tuple[float, float, float, float]]  # (cx, cy, w, h) por panel
    cut: bool = False


@dataclass
class Plan:
    mode: str                     # 'single' | 'split'
    keys: list[CropKey]
    width: int
    height: int
    fps: float
    n_frames: int

    def rects_at(self, t: float) -> list[tuple[int, int, int, int]]:
        """Rectángulos (x, y, w, h) enteros para el instante t, interpolando
        entre muestras salvo cuando hay un corte."""
        keys = self.keys
        if not keys:
            return []
        if t <= keys[0].t:
            k = keys[0]
            return [_clamp_rect(r, self.width, self.height) for r in k.rects]
        lo, hi = 0, len(keys) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if keys[mid].t <= t:
                lo = mid
            else:
                hi = mid - 1
        a = keys[lo]
        if lo + 1 >= len(keys) or keys[lo + 1].cut:
            return [_clamp_rect(r, self.width, self.height) for r in a.rects]
        b = keys[lo + 1]
        f = (t - a.t) / max(1e-6, (b.t - a.t))
        f = min(1.0, max(0.0, f))
        rects = []
        for ra, rb in zip(a.rects, b.rects):
            rects.append(tuple(ra[i] + (rb[i] - ra[i]) * f for i in range(4)))
        return [_clamp_rect(r, self.width, self.height) for r in rects]


def _clamp_rect(r: tuple[float, float, float, float], W: int, H: int) -> tuple[int, int, int, int]:
    cx, cy, w, h = r
    w = min(w, W)
    h = min(h, H)
    x = min(max(0.0, cx - w / 2), W - w)
    y = min(max(0.0, cy - h / 2), H - h)
    return int(round(x)), int(round(y)), int(round(w)), int(round(h))


def _single_crop_size(W: int, H: int, zoom: float = 1.0) -> tuple[float, float]:
    cw = min(float(W), H * 9.0 / 16.0)
    ch = cw * 16.0 / 9.0
    return cw / zoom, ch / zoom


def _split_crop_size(W: int, H: int) -> tuple[float, float]:
    cw = min(float(W), H * 9.0 / 8.0)
    ch = cw * 8.0 / 9.0
    return cw, ch


def build_plan(analysis: Analysis, preset: dict, speaker_changes: list[float] | None = None) -> Plan:
    W, H = analysis.width, analysis.height
    cam = preset.get("camera", {})
    smoothing = float(cam.get("smoothing", 0.85))
    zoom_on_change = bool(cam.get("zoom_on_speaker_change"))
    zoom_amount = float(cam.get("zoom_amount", 1.0)) if zoom_on_change else 1.0
    two_mode = preset.get("two_speakers", "switch")
    times = analysis.sample_times
    n = len(times)
    speaker_changes = sorted(speaker_changes or [])

    # Personas "principales": tracks que aparecen en al menos el 20% de las muestras.
    main = sorted(
        [tr for tr in analysis.tracks if tr.hits >= max(3, 0.2 * n)],
        key=lambda tr: -tr.hits,
    )[:2]
    for tr in main:
        tr.activity = tr.activity[:n] + [0.0] * max(0, n - len(tr.activity))

    dead_zone = W * 0.03
    default_center = (W / 2.0, H / 2.0)

    if len(main) == 2 and two_mode == "split":
        cw, ch = _split_crop_size(W, H)
        ordered = sorted(main, key=lambda tr: _mean_cx(tr))
        keys: list[CropKey] = []
        cur = [None, None]
        for si, t in enumerate(times):
            rects = []
            for p, tr in enumerate(ordered):
                target = tr.centers.get(si)
                if target is None:
                    target = _nearest_center(tr, si) or (default_center[0], default_center[1], H)
                cx, cy = _smooth(cur[p], (target[0], target[1]), smoothing, dead_zone)
                cur[p] = (cx, cy)
                rects.append((cx, cy, cw, ch))
            keys.append(CropKey(t, rects))
        return Plan("split", keys, W, H, analysis.fps, analysis.n_frames)

    cw0, ch0 = _single_crop_size(W, H)
    keys = []
    if not main:
        for t in times:
            keys.append(CropKey(t, [(default_center[0], default_center[1], cw0, ch0)]))
        if not keys:
            keys.append(CropKey(0.0, [(default_center[0], default_center[1], cw0, ch0)]))
        return Plan("single", keys, W, H, analysis.fps, analysis.n_frames)

    active = main[0]
    cur_center: tuple[float, float] | None = None
    last_switch_t = -1e9
    pending = 0
    last_cut_t = -1e9
    sc_idx = 0
    for si, t in enumerate(times):
        cut = False
        if len(main) == 2:
            other = main[1] if active is main[0] else main[0]
            a_act = sum(active.activity[max(0, si - ACTIVITY_WINDOW + 1): si + 1])
            o_act = sum(other.activity[max(0, si - ACTIVITY_WINDOW + 1): si + 1])
            other_visible = other.centers.get(si) is not None or _nearest_center(other, si, 1.0) is not None
            active_visible = active.centers.get(si) is not None or _nearest_center(active, si, 1.0) is not None
            # Cambio de hablante según diarización: permite cortar antes.
            diar_hint = False
            while sc_idx < len(speaker_changes) and speaker_changes[sc_idx] <= t:
                diar_hint = True
                sc_idx += 1
            if other_visible and (o_act > a_act * 1.3 + 0.002 or not active_visible):
                pending += 1
            else:
                pending = max(0, pending - 1)
            need = 1 if diar_hint and o_act >= a_act else SWITCH_CONFIRM_SAMPLES
            if (pending >= need or not active_visible) and (t - last_switch_t) >= SWITCH_MIN_DWELL_S and other_visible:
                active = other
                last_switch_t = t
                pending = 0
                cut = True
                cur_center = None
        target = active.centers.get(si) or _nearest_center(active, si)
        if target is None:
            target = (cur_center[0], cur_center[1], H) if cur_center else (default_center[0], default_center[1], H)
        cx, cy = _smooth(cur_center, (target[0], target[1]), smoothing, dead_zone)
        cur_center = (cx, cy)
        if cut:
            last_cut_t = t
        zoom = 1.0
        if zoom_on_change and zoom_amount > 1.0 and (t - last_cut_t) < ZOOM_EASE_S:
            f = (t - last_cut_t) / ZOOM_EASE_S
            zoom = zoom_amount - (zoom_amount - 1.0) * (f * f * (3 - 2 * f))
        cw, ch = _single_crop_size(W, H, zoom)
        keys.append(CropKey(t, [(cx, cy, cw, ch)], cut=cut))
    return Plan("single", keys, W, H, analysis.fps, analysis.n_frames)


def _mean_cx(tr: Track) -> float:
    if not tr.centers:
        return 0.0
    return sum(c[0] for c in tr.centers.values()) / len(tr.centers)


def _nearest_center(tr: Track, si: int, max_gap_s: float = 3.0) -> tuple[float, float, float] | None:
    max_gap = int(max_gap_s * SAMPLE_FPS)
    for d in range(1, max_gap + 1):
        for k in (si - d, si + d):
            if k in tr.centers:
                return tr.centers[k]
    return None


def _smooth(cur: tuple[float, float] | None, target: tuple[float, float], smoothing: float, dead_zone: float):
    if cur is None:
        return target
    dx, dy = target[0] - cur[0], target[1] - cur[1]
    if math.hypot(dx, dy) < dead_zone:
        return cur
    a = 1.0 - min(0.98, max(0.0, smoothing))
    return cur[0] + dx * a, cur[1] + dy * a
