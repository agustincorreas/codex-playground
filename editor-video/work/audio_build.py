"""Voice + SFX mix for the edit.
1) run the voice chain on the WHOLE source (so gate/compressors see continuous audio), 2) splice by the EDL with short crossfades,
3) static gain to the loudness target, 4) place SFX levelled by K-weighted 100 ms loudness, 5) mix-bus limiter, 6) report.

usage: audio_build.py <project.json> <outdir>
project.json: src, segments[{in,out}], audio_cfg{xfade_ms, voice_chain, target_lufs, true_peak, sfx_dir}, sfx[{t, name, k100 (LUFS target) | gain_db, pan, pre, max_peak_db}]
"""
import sys, json, os, subprocess, re
import numpy as np, soundfile as sf
from scipy.signal import lfilter

proj = json.load(open(sys.argv[1])); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
A = proj.get("audio_cfg", {})
SR = 48000
chain = A.get("voice_chain") or "pan=mono|c0=c0,highpass=f=85:poles=2"

# 1) full-file voice processing (mono in, mono out)
key = re.sub(r"[^a-z0-9]", "", chain.lower())[-40:] + f"_{abs(hash(chain)) % 10**8}"
proc = f"{outdir}/src_processed.wav"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", proj["src"], "-vn", "-af", f"aresample={SR},{chain}", "-ac", "1", "-c:a", "pcm_f32le", proc], check=True)
x, _ = sf.read(proc); x = x.astype(np.float64)
if x.ndim > 1: x = x.mean(1)

# 1b) gentle level rider (post-chain) for passages that stay soft after levelling: [[src_start, src_end, dB], ...]
for a0, b0, g_db in A.get("post_gain", []):
    n0, n1 = int(a0 * SR), int(b0 * SR); r = int(0.15 * SR)
    env = np.ones(len(x)); env[n0:n1] = 10 ** (g_db / 20)
    k = np.hanning(2 * r + 1); k /= k.sum(); env = np.convolve(env, k, mode="same")
    x = x * env

# 1c) explicit extra attenuation of non-word sounds the aligner cannot see (trailing hums): [[src_start, src_end, dB, ramp_s], ...]
for a0, b0, g_db, r_s in A.get("duck_extra", []):
    n0, n1 = int(a0 * SR), int(b0 * SR); r = max(1, int(r_s * SR))
    env = np.ones(len(x)); env[n0:n1] = 10 ** (g_db / 20)
    k = np.hanning(2 * r + 1); k /= k.sum(); env = np.convolve(env, k, mode="same")
    x = x * env

# 2) splice: the outgoing tail gets a long release (word tails / room decay are not chopped), the incoming side a short fade-in
segs = proj["segments"]
total = int(round(sum(s["out"] - s["in"] for s in segs) * SR))
y = np.zeros(total + SR)
pos = 0.0
FO = int(A.get("fade_out_ms", 70) / 1000 * SR); FI = int(A.get("fade_in_ms", 12) / 1000 * SR)
fout = np.cos(np.linspace(0, np.pi / 2, FO)) ** 2; fin = np.sin(np.linspace(0, np.pi / 2, FI)) ** 2
for k, s in enumerate(segs):
    a = int(round(s["in"] * SR)); b = int(round(s["out"] * SR)); p = int(round(pos * SR))
    chunk = x[a:b].copy()
    if k > 0: chunk[:FI] *= fin
    if k < len(segs) - 1: chunk[-FO:] *= fout
    y[p:p + len(chunk)] += chunk
    pos += s["out"] - s["in"]
y = y[:total]
nf = int(0.02 * SR); y[:nf] *= np.linspace(0, 1, nf)
nf = int(A.get("end_fade_ms", 300) / 1000 * SR); y[-nf:] *= np.cos(np.linspace(0, np.pi / 2, nf)) ** 2
full = int(round(proj.get("duration", total / SR) * SR))
if full > total: y = np.concatenate([y, np.zeros(full - total)]); total = full          # end-card hold: silence under the SFX tail
st = np.stack([y, y], 1)
sf.write(f"{outdir}/cut.wav", st.astype(np.float32), SR, subtype="FLOAT")

def loud(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    tail = r[r.rfind("Summary:"):]
    g = lambda pat: float(re.search(pat, tail).group(1))
    return {"I": g(r"I:\s+(-?[\d.]+) LUFS"), "LRA": g(r"LRA:\s+(-?[\d.]+) LU"), "TP": g(r"Peak:\s+(-?[\d.]+) dBFS")}

# 2b) alignment-informed pause ducking: everything that is not a word (breaths, lip clicks, table knocks lifted by the compressors)
#     is turned down, with soft ramps; words keep generous handles so no onset or tail is touched
W = proj.get("words") or []
duck_db = A.get("pause_duck_db", 0.0)
if W and duck_db > 0:
    PRE, POST, RAMP = 0.07, 0.16, 0.040
    TAIL_THR, SIL_THR = -36.0, -50.0       # dBFS before the loudness gain: "still sounding" / "really silent"
    soft_db = A.get("pause_duck_soft_db", duck_db)
    keep = np.zeros(total, bool)
    hop = int(0.005 * SR); lev = 20 * np.log10(np.sqrt(np.convolve(y ** 2, np.ones(hop * 4) / (hop * 4), mode="same")) + 1e-9)
    for w in W:
        a = int(max(0, (w["s"] - PRE) * SR)); b = int(min(total, (w["e"] + POST) * SR))
        # a word tail that is still clearly sounding (held vowels end later than the aligner says) stays protected
        lim_b = int(min(total, (w["e"] + 0.60) * SR))
        while b < lim_b and lev[b] > TAIL_THR: b += hop
        keep[a:b] = True
    g = np.where(keep, 1.0, 10 ** (-duck_db / 20))
    # a gap that never falls silent (a hum or a held sound running into the next word) only gets a shallow dip: no audible pumping
    ws = sorted(W, key=lambda w: w["s"]); need = int(0.04 * SR)
    for w0, w1 in zip(ws, ws[1:]):
        a, b = int(w0["e"] * SR), int(w1["s"] * SR)
        if b - a < int(0.03 * SR): continue
        quiet = lev[a:b] < SIL_THR; run = best = 0
        for q in quiet[::hop]:
            run = run + hop if q else 0; best = max(best, run)
        if best < need: g[a:b] = np.where(keep[a:b], 1.0, 10 ** (-soft_db / 20))
    n = int(RAMP * SR); k = np.hanning(2 * n + 1); k /= k.sum()
    g = np.minimum(np.convolve(g, k, mode="same"), 1.0)
    g[keep] = np.maximum(g[keep], 0.92)
    y = y * g
    st = np.stack([y, y], 1)
    sf.write(f"{outdir}/cut.wav", st.astype(np.float32), SR, subtype="FLOAT")

LAT = 143   # ffmpeg alimiter (attack 3 ms) delays the signal by 143 samples at 48 kHz; trimmed after each pass
# 3) loudness target (stereo measurement) + transparent limiter
m = loud(f"{outdir}/cut.wav"); target = A.get("target_lufs", -14.0); tp = A.get("true_peak", -1.0); lim = 10 ** (tp / 20)
gain = target - m["I"]
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{outdir}/cut.wav", "-af", f"volume={gain:.2f}dB,alimiter=limit={lim:.4f}:attack=3:release=60:level=disabled",
                "-c:a", "pcm_f32le", f"{outdir}/voice.wav"], check=True)
v, _ = sf.read(f"{outdir}/voice.wav"); v = v.astype(np.float64)
v = np.concatenate([v[LAT:], np.zeros((LAT, 2))])
# second trim so the limited voice sits on target
m2 = loud(f"{outdir}/voice.wav"); v *= 10 ** ((target - m2["I"]) / 20); v = np.clip(v, -lim, lim)

# 4) SFX, levelled by K-weighted 100 ms loudness (BS.1770 pre-filter)
def kweight(sig):
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]; a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]; a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return lfilter(b2, a2, lfilter(b1, a1, sig, axis=0), axis=0)
def k100(sig):
    k = kweight(sig); n = int(0.1 * SR); p = (k ** 2).sum(1) if k.ndim == 2 else k ** 2 * 2
    if len(p) < n: return -99.0
    c = np.convolve(p, np.ones(n) / n, mode="valid")
    return -0.691 + 10 * np.log10(c.max() + 1e-12)
voice_k = k100(v)
mix = v.copy(); placed = []
for e in proj.get("sfx", []):
    s, _ = sf.read(f"{A['sfx_dir']}/{e['name']}.wav"); s = s.astype(np.float64)
    if e.get("hp"):
        from scipy.signal import butter, sosfilt
        s = sosfilt(butter(2, e["hp"], btype="high", fs=SR, output="sos"), s, axis=0)
    pan = e.get("pan", 0.0); gl, gr = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2), np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    s = s * np.array([gl, gr])[None, :]
    if "k100" in e: g = 10 ** ((e["k100"] - k100(s)) / 20)
    else: g = 10 ** (e.get("gain_db", -12.0) / 20)
    pk = np.abs(s).max() * g; cap = 10 ** (e.get("max_peak_db", -9.0) / 20)
    if pk > cap: g *= cap / pk
    s = s * g
    p = int(round((e["t"] - e.get("pre", 0.0)) * SR))
    if p < 0: s = s[-p:]; p = 0
    n = min(len(s), len(mix) - p)
    if n <= 0: continue
    mix[p:p + n] += s[:n]
    placed.append({"t": e["t"], "name": e["name"], "k100_lufs": round(float(k100(s[:n])), 1), "peak_db": round(float(20 * np.log10(np.abs(s[:n]).max() + 1e-12)), 1)})
sf.write(f"{outdir}/mix_pre.wav", mix.astype(np.float32), SR, subtype="FLOAT")
# 5) mix bus limiter (oversampled so the ceiling holds as true peak)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{outdir}/mix_pre.wav", "-af", f"aresample=192000,alimiter=limit={lim:.4f}:attack=3:release=60:level=disabled,aresample={SR}",
                "-c:a", "pcm_s24le", f"{outdir}/mix.wav"], check=True)
mx, _ = sf.read(f"{outdir}/mix.wav"); mx = np.concatenate([mx[LAT:], np.zeros((LAT, 2))])
nf = int(0.09 * SR); mx[-nf:] *= (np.cos(np.linspace(0, np.pi / 2, nf)) ** 2)[:, None]; mx[-8:] = 0.0      # master fade to digital silence
sf.write(f"{outdir}/mix.wav", mx, SR, subtype="PCM_24")
rep = {"cut": m, "gain_db": round(gain, 2), "voice_k100_max_lufs": round(float(voice_k), 1), "mix": loud(f"{outdir}/mix.wav"), "duration": total / SR, "sfx": placed}
sf.write(f"{outdir}/voice_final.wav", v.astype(np.float32), SR, subtype="FLOAT")
rep["voice"] = loud(f"{outdir}/voice_final.wav")
json.dump(rep, open(f"{outdir}/report.json", "w"), indent=1)
print(json.dumps({k: rep[k] for k in ("cut", "gain_db", "voice", "mix", "duration", "voice_k100_max_lufs")}))
for p in placed: print("  sfx", p)
