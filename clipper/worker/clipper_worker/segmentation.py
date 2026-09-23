"""Segmentación de personas (U²-Net human_seg vía onnxruntime) para efectos como
"título por detrás del sujeto". Se carga solo cuando un preset lo pide."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .config import config
from .errors import UserError
from .log import get_logger

log = get_logger(__name__)

INPUT = 320
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class PersonSegmenter:
    def __init__(self, model_path: str | None = None, smoothing: float = 0.5):
        try:
            import onnxruntime as ort
        except ImportError as e:
            raise UserError("El efecto 'título por detrás' necesita `pip install onnxruntime`.") from e
        path = model_path or config.SEGMENTATION_MODEL_PATH
        if not path or not Path(path).exists():
            raise UserError(f"No encontré el modelo de segmentación en {path} (SEGMENTATION_MODEL_PATH).")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (config.FFMPEG_THREADS or 0) or 4)
        self.session = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.prev: np.ndarray | None = None
        self.smoothing = smoothing
        log.info("segmentación de personas: %s", path)

    def mask(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Máscara float32 [0..1] del tamaño del cuadro: 1 = persona."""
        h, w = frame_bgr.shape[:2]
        small = cv2.resize(frame_bgr, (INPUT, INPUT), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - MEAN) / STD
        x = np.transpose(rgb, (2, 0, 1))[None].astype(np.float32)
        out = self.session.run(None, {self.input_name: x})[0]
        pred = out[0, 0]
        lo, hi = float(pred.min()), float(pred.max())
        pred = (pred - lo) / max(1e-6, hi - lo)
        m = cv2.resize(pred.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
        m = cv2.GaussianBlur(m, (0, 0), 3)
        if self.prev is not None and self.prev.shape == m.shape:
            m = self.prev * self.smoothing + m * (1.0 - self.smoothing)
        self.prev = m
        return np.clip(m, 0.0, 1.0)
