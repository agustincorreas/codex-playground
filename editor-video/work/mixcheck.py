"""Post-render audio checks. usage: mixcheck.py <projdir>
 1) every kept word keeps a constant gain versus the undipped splice (ducking never touches a word)
 2) each sound effect versus the simultaneous voice (K-weighted 100 ms), using the SFX stem = mix_pre - voice_final
"""
import os
import sys, json, numpy as np, soundfile as sf
from scipy.signal import lfilter
pd = os.path.abspath(sys.argv[1]); P = json.load(open(f"{pd}/project.json")); SR = 48000
v, _ = sf.read(f"{pd}/audio/voice_final.wav"); mp, _ = sf.read(f"{pd}/audio/mix_pre.wav"); x, _ = sf.read(f"{pd}/audio/src_processed.wav")
if x.ndim > 1: x = x.mean(1)
vm = v.mean(1); n = min(len(v), len(mp)); sfx = mp[:n] - v[:n]
# undipped splice of the processed source (same fades as the build)
A = P["audio_cfg"]; FO = int(A.get("fade_out_ms", 70) / 1000 * SR); FI = int(A.get("fade_in_ms", 12) / 1000 * SR)
parts = []
for k, s in enumerate(P["segments"]):
    c = x[int(round(s["in"] * SR)):int(round(s["out"] * SR))].copy()
    if k > 0: c[:FI] *= np.sin(np.linspace(0, np.pi / 2, FI)) ** 2
    if k < len(P["segments"]) - 1: c[-FO:] *= np.cos(np.linspace(0, np.pi / 2, FO)) ** 2
    parts.append(c)
y = np.concatenate(parts)
def rms(a): return 20 * np.log10(np.sqrt((a ** 2).mean()) + 1e-9)
gains = []; worst = []
for w in P["words"]:
    a, b = int(w["s"] * SR), int(w["e"] * SR)
    if b - a < int(0.03 * SR) or b > len(y) or b > len(vm): continue
    g_all = rms(vm[a:b]) - rms(y[a:b]); m = int(0.04 * SR)
    g_head = rms(vm[a:a + m]) - rms(y[a:a + m]); g_tail = rms(vm[b - m:b]) - rms(y[b - m:b])
    gains.append(g_all); worst.append((min(g_head, g_tail) - g_all, w["w"], round(w["s"], 2), round(g_head - g_all, 1), round(g_tail - g_all, 1)))
G = np.median(gains)
print(f"words checked {len(gains)}; median gain {G:.2f} dB; per-word gain spread: min {min(gains) - G:+.2f} max {max(gains) - G:+.2f} dB")
worst.sort(); print("largest head/tail dips inside a word (dB vs the word, word, time, head, tail):", [w for w in worst[:6]])
# pauses: how much is taken off between words
def kw(sig):
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]; a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]; a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return lfilter(b2, a2, lfilter(b1, a1, sig, axis=0), axis=0)
def k100_track(sig):
    k = kw(sig); p = (k ** 2).sum(1); nn = int(0.1 * SR); c = np.convolve(p, np.ones(nn) / nn, mode="same")
    return -0.691 + 10 * np.log10(c + 1e-12)
kv = k100_track(v[:n]); ks = k100_track(sfx)
print("\nSFX vs simultaneous voice (K-weighted 100 ms):  time name | sfx peak LUFS | voice there | margin dB")
for e in P["sfx"]:
    a = int(max(0, e["t"] - e.get("pre", 0)) * SR); b = min(n, a + int(1.2 * SR))
    i = a + int(np.argmax(ks[a:b]))
    print(f"  {e['t']:7.2f} {e['name']:14s} | {ks[i]:6.1f} | {kv[i]:6.1f} | {kv[i] - ks[i]:5.1f}")
