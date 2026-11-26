"""Spectrogram + level plot with word labels. usage: specplot.py a b out.png"""
import os
import sys, json, numpy as np, soundfile as sf, cv2
from scipy.signal import stft
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
a, b, out = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
x, sr = sf.read(f"{S}/audio/src_48k.wav", start=int(a * 48000), stop=int(b * 48000)); x = x.mean(1)
f, t, Z = stft(x, fs=sr, nperseg=1024, noverlap=1024 - 240)   # 5 ms hop
M = 20 * np.log10(np.abs(Z) + 1e-7); keep = f <= 8000; M = M[keep]
img = np.clip((M + 100) / 80, 0, 1); img = (img[::-1] * 255).astype(np.uint8)
Wpx = 1800; Hs = 420
img = cv2.resize(img, (Wpx, Hs), interpolation=cv2.INTER_AREA); img = cv2.applyColorMap(img, cv2.COLORMAP_MAGMA)
# level trace
hop = 240; n = len(x) // hop
db = 20 * np.log10(np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-7)
Hl = 220; lv = np.full((Hl, Wpx, 3), 255, np.uint8)
for d in (-70, -60, -50, -40, -30, -20):
    y = int((-10 - d) / 70 * Hl); cv2.line(lv, (0, y), (Wpx, y), (220, 220, 220), 1); cv2.putText(lv, str(d), (2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (120, 120, 120), 1)
pts = np.array([[int(i / n * Wpx), int(np.clip((-10 - v) / 70, 0, 1) * Hl)] for i, v in enumerate(db)], np.int32)
cv2.polylines(lv, [pts], False, (30, 30, 200), 1)
# labels: whisper verbatim words + parakeet starts
lab = np.full((90, Wpx, 3), 255, np.uint8)
ws = json.load(open(f"{S}/analysis/src_words.json"))["words"]
for k, w in enumerate(ws):
    if w["e"] < a or w["s"] > b: continue
    x0 = int((w["s"] - a) / (b - a) * Wpx); x1 = max(x0 + 2, int((w["e"] - a) / (b - a) * Wpx))
    row = 4 if k % 2 == 0 else 46
    cv2.rectangle(lab, (x0, row), (x1, row + 14), (200, 230, 200), -1); cv2.rectangle(lab, (x0, row), (x1, row + 14), (0, 120, 0), 1)
    cv2.putText(lab, w["w"].strip()[:14], (x0 + 1, row + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1)
ax = np.full((28, Wpx, 3), 255, np.uint8)
tt = np.ceil(a * 4) / 4
while tt < b:
    xx = int((tt - a) / (b - a) * Wpx); major = abs(tt - round(tt)) < 1e-6
    for im in (img, lv): cv2.line(im, (xx, 0), (xx, im.shape[0]), (255, 255, 255) if im is img else (200, 200, 200), 1 if major else 1)
    if major or (b - a) < 6: cv2.putText(ax, f"{tt:.2f}".rstrip("0").rstrip("."), (xx + 2, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
    tt += 0.25
cv2.imwrite(out, np.vstack([ax, lab, img, lv]))
