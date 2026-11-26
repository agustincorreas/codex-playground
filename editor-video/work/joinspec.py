"""Spectrogram strips of the spliced audio around each cut of an EDL. usage: joinspec.py <edl.json> <out.png> [cut indices comma-separated]"""
import os
import sys, json, numpy as np, soundfile as sf, cv2
from scipy.signal import stft
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
E = json.load(open(sys.argv[1])); out = sys.argv[2]
sel = [int(v) for v in sys.argv[3].split(",")] if len(sys.argv) > 3 else None
x, sr = sf.read(f"{S}/audio/src_48k.wav"); x = x.mean(1) if x.ndim > 1 else x
parts = []
FO, FI = int(0.070 * sr), int(0.012 * sr)
for k, s in enumerate(E["segments"]):
    seg = x[int(round(s["in"] * sr)):int(round(s["out"] * sr))].copy()
    if k > 0: seg[:FI] *= np.linspace(0, 1, FI)
    if k < len(E["segments"]) - 1: seg[-FO:] *= np.linspace(1, 0, FO)
    parts.append(seg)
y = np.concatenate(parts)
cuts = [c for c in E["cuts"] if "out_time" in c]
rows = []
for k, c in enumerate(cuts):
    if sel is not None and k not in sel: continue
    t = c["out_time"]; a, b = max(0, t - 0.9), t + 0.9
    seg = y[int(a * sr):int(b * sr)]
    f, tt, Z = stft(seg, fs=sr, nperseg=1024, noverlap=1024 - 240)
    M = 20 * np.log10(np.abs(Z) + 1e-7); M = M[f <= 8000]
    img = np.clip((M + 100) / 80, 0, 1); img = (img[::-1] * 255).astype(np.uint8)
    Wpx, Hs = 1500, 260
    img = cv2.applyColorMap(cv2.resize(img, (Wpx, Hs), interpolation=cv2.INTER_AREA), cv2.COLORMAP_MAGMA)
    xc = int((t - a) / (b - a) * Wpx); cv2.line(img, (xc, 0), (xc, Hs), (0, 255, 0), 1)
    hop = 240; n = len(seg) // hop
    db = 20 * np.log10(np.sqrt((seg[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-7)
    Hl = 110; lv = np.full((Hl, Wpx, 3), 255, np.uint8)
    for d in (-60, -40, -20):
        yy = int((-10 - d) / 70 * Hl); cv2.line(lv, (0, yy), (Wpx, yy), (220, 220, 220), 1); cv2.putText(lv, str(d), (2, yy - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (120, 120, 120), 1)
    pts = np.array([[int(i / n * Wpx), int(np.clip((-10 - v) / 70, 0, 1) * Hl)] for i, v in enumerate(db)], np.int32)
    cv2.polylines(lv, [pts], False, (30, 30, 200), 1); cv2.line(lv, (xc, 0), (xc, Hl), (0, 160, 0), 1)
    lab = np.full((52, Wpx, 3), 255, np.uint8)
    for j, w in enumerate(E["words"]):
        if w["e"] < a or w["s"] > b: continue
        x0 = int((w["s"] - a) / (b - a) * Wpx); x1 = max(x0 + 2, int((w["e"] - a) / (b - a) * Wpx))
        row = 2 if j % 2 == 0 else 26
        cv2.rectangle(lab, (x0, row), (x1, row + 8), (0, 120, 0), -1); cv2.putText(lab, w["w"][:14], (x0 + 1, row + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
    cv2.putText(lab, f"cut {k} @ {t:.2f}s  src {c['cut_out']:.2f}->{c['cut_in']:.2f}  {c['after']} | {c['before']}", (Wpx - 560, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 0, 0), 1)
    rows.append(np.vstack([lab, img, lv]))
cv2.imwrite(out, np.vstack(rows))
sf.write(out.replace(".png", ".wav"), y, sr)
print(len(rows), "strips", round(len(y) / sr, 2), "s")
