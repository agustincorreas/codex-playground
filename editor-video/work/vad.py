"""Energy VAD at 5 ms hop. Usage: vad.py <wav48k> <out.json>. Speech = band-limited level above adaptive noise floor (hysteresis)."""
import sys, json, numpy as np, soundfile as sf
from scipy.signal import butter, sosfiltfilt
x, sr = sf.read(sys.argv[1]); x = x.mean(1) if x.ndim > 1 else x
sos = butter(4, [90, 9000], btype="band", fs=sr, output="sos"); y = sosfiltfilt(sos, x)
hop = int(0.005 * sr); win = int(0.020 * sr)
n = (len(y) - win) // hop
idx = np.arange(n)[:, None] * hop + np.arange(win)[None, :]
rms = np.sqrt((y[idx] ** 2).mean(1) + 1e-12); db = 20 * np.log10(rms)
floor = float(np.percentile(db, 8)); peak = float(np.percentile(db, 98))
hi_thr = peak - 24.0; lo_thr = peak - 32.0   # speech-relative thresholds: room noise/breaths sit ~40 dB below speech peaks
sp = np.zeros(n, bool); on = False
for i in range(n):
    if not on and db[i] > hi_thr: on = True
    elif on and db[i] < lo_thr: on = False
    sp[i] = on
# extend each speech run backwards to where level first exceeded lo_thr (soft onsets)
i = 1
while i < n:
    if sp[i] and not sp[i - 1]:
        j = i - 1
        while j >= 0 and db[j] > lo_thr and not sp[j]: sp[j] = True; j -= 1
    i += 1
# drop blips < 30 ms, fill holes < 60 ms
def runs(m):
    r = []; s = None
    for i, v in enumerate(m):
        if v and s is None: s = i
        if not v and s is not None: r.append((s, i)); s = None
    if s is not None: r.append((s, len(m)))
    return r
for a, b in runs(~sp):
    if (b - a) * 0.005 < 0.06 and a > 0 and b < n: sp[a:b] = True
for a, b in runs(sp):
    if (b - a) * 0.005 < 0.09: sp[a:b] = False   # isolated clicks / taps are not speech
segs = [(round(a * 0.005, 3), round(b * 0.005 + 0.015, 3), round(float(db[a:b].max()), 1)) for a, b in runs(sp)]
json.dump({"floor_db": floor, "peak_db": peak, "hi_thr": hi_thr, "lo_thr": lo_thr, "hop": 0.005, "db": [round(float(v), 1) for v in db], "speech": segs}, open(sys.argv[2], "w"))
print(f"floor {floor:.1f} dB  peak {peak:.1f} dB  thr hi {hi_thr:.1f} lo {lo_thr:.1f}  segments {len(segs)}")
prev = 0.0
for a, b, m in segs:
    if a - prev >= 0.18: print(f"  pause {prev:8.3f} -> {a:8.3f}  ({a - prev:.2f}s)")
    prev = b
print(f"  tail  {prev:.3f} -> {len(x) / sr:.3f}")
