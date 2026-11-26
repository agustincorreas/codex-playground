"""Synthesize a small, restrained SFX palette (48 kHz stereo float WAVs). All sounds are original (generated here), so no licensing issues.
usage: sfx.py <outdir>"""
import sys, os, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(7)

def env_exp(n, tau): return np.exp(-np.arange(n) / (tau * SR))
def fade(x, a=0.004, r=0.02):
    na, nr = int(a * SR), int(r * SR); y = x.copy()
    y[:na] *= np.sin(np.linspace(0, np.pi / 2, na)) ** 2 if y.ndim == 1 else (np.sin(np.linspace(0, np.pi / 2, na)) ** 2)[:, None]
    w = np.cos(np.linspace(0, np.pi / 2, nr)) ** 2
    y[-nr:] *= w if y.ndim == 1 else w[:, None]
    return y
def pink(n):
    w = rng.standard_normal(n); f = np.fft.rfft(w); k = np.arange(len(f)); k[0] = 1
    return np.fft.irfft(f / np.sqrt(k), n) / 6.0
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)
def lp(x, fc, order=2): return sosfilt(butter(order, fc, btype="low", fs=SR, output="sos"), x)
def hp(x, fc, order=2): return sosfilt(butter(order, fc, btype="high", fs=SR, output="sos"), x)
def reverb(x, t60=0.9, wet=0.25, bright=6000, predelay=0.012):
    n = int(t60 * SR * 1.2)
    ir = np.stack([lp(rng.standard_normal(n), bright) for _ in range(2)], 1) * np.exp(-6.9 * np.arange(n) / (t60 * SR))[:, None]
    ir /= np.sqrt((ir ** 2).sum(0)).mean()
    pd = int(predelay * SR)
    x2 = (x if x.ndim == 2 else np.stack([x, x], 1)).copy()
    nt = max(64, int(0.25 * len(x2)))            # fade the dry tail so it never ends on a step (click)
    x2[-nt:] *= (np.cos(np.linspace(0, np.pi / 2, nt)) ** 2)[:, None]
    wetsig = np.stack([fftconvolve(x2[:, c], ir[:, c]) for c in range(2)], 1)
    y = np.zeros((len(wetsig) + pd, 2)); y[: len(x2)] += x2 * (1 - wet * 0.3); y[pd:] += wetsig * wet
    return y
def st(x): return x if x.ndim == 2 else np.stack([x, x], 1)
def norm(x, peak_db):
    return x * (10 ** (peak_db / 20) / (np.abs(x).max() + 1e-12))
def save(name, x, peak_db=-6.0):
    x = norm(st(x), peak_db); sf.write(f"{out}/{name}.wav", x.astype(np.float32), SR, subtype="FLOAT")
    rms = 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)
    print(f"{name:14s} {len(x) / SR:5.2f}s  peak {peak_db:5.1f} dBFS  rms {rms:6.1f} dBFS")

def sweep_filter(noise, f_path, q=1.2):
    """Time-varying band-pass via short overlapping blocks."""
    n = len(noise); blk = 1024; hop = 256; y = np.zeros(n + blk); win = np.hanning(blk)
    for s in range(0, n - blk, hop):
        fc = f_path[s + blk // 2]; lo = max(40, fc / (2 ** (1 / (2 * q)))); hi = min(SR / 2 - 100, fc * (2 ** (1 / (2 * q))))
        y[s:s + blk] += bp(noise[s:s + blk] * win, lo, hi, 1) * win
    return y[:n] / 1.5

# 1) soft air whoosh (title / card entrances): filtered-noise sweep, bell envelope, slight L->R motion
def whoosh(dur=0.50, f0=350, f1=2600, f2=900, peak_pos=0.55):
    n = int(dur * SR); t = np.linspace(0, 1, n)
    f = np.where(t < peak_pos, f0 * (f1 / f0) ** (t / peak_pos), f1 * (f2 / f1) ** ((t - peak_pos) / (1 - peak_pos)))
    a = np.exp(-0.5 * ((t - peak_pos) / 0.20) ** 2)
    x = sweep_filter(pink(n) * 4, f, q=0.9) * a
    pan = 0.35 + 0.30 * t
    y = np.stack([x * np.cos(pan * np.pi / 2), x * np.sin(pan * np.pi / 2)], 1)
    return fade(reverb(y, t60=0.5, wet=0.12), 0.01, 0.08)
save("whoosh_soft", whoosh(), -9)
save("whoosh_short", whoosh(dur=0.32, f0=500, f1=3200, f2=1400, peak_pos=0.5), -10)

# 2) rounded pop (note chips / small elements): sine with fast downward glide
def pop(f0=620, f1=330, dur=0.11, tau=0.028):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.012)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, tau)
    x += 0.15 * hp(rng.standard_normal(n), 3000) * env_exp(n, 0.004)
    return fade(reverb(x, t60=0.25, wet=0.08), 0.001, 0.03)
save("pop_soft", pop(), -10)
save("pop_high", pop(f0=880, f1=520, tau=0.022), -11)

# 3) tick (list items / subtle accents)
def tick(dur=0.06):
    n = int(dur * SR)
    x = bp(rng.standard_normal(n), 1800, 6500) * env_exp(n, 0.006)
    x += 0.5 * np.sin(2 * np.pi * 2100 * np.arange(n) / SR) * env_exp(n, 0.008)
    return fade(reverb(x, t60=0.2, wet=0.06), 0.0005, 0.02)
save("tick", tick(), -12)

# 4) shimmer / chime (gold reveal): inharmonic bell partials with long airy tail
def shimmer(base=1046.5, dur=1.6):
    n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n); k = min(1.0, dur / 1.6)
    for ratio, amp, tau in ((1.0, 1.0, 0.45), (2.0, 0.55, 0.35), (2.997, 0.35, 0.28), (4.07, 0.22, 0.2), (5.19, 0.12, 0.14), (1.498, 0.3, 0.4)):
        x += amp * np.sin(2 * np.pi * base * ratio * t + rng.uniform(0, 6.28)) * np.exp(-t / (tau * k))
    x *= 1 - np.exp(-t / 0.004)
    air = hp(pink(n) * 3, 6000) * np.exp(-t / 0.25) * 0.08
    return fade(reverb(x + air, t60=1.4 * k, wet=0.35 * (0.6 + 0.4 * k), bright=9000), 0.002, 0.3 * k)
save("shimmer", shimmer(), -10)
save("shimmer_low", shimmer(base=783.99, dur=1.4), -11)

# 5) soft hit (hook / pay-off): low sine with pitch drop PLUS a 130-260 Hz body and a short 1-3 kHz "thock" so it survives phone speakers
def sub_hit(dur=0.9):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 46 + 44 * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    fb = 150 + 110 * np.exp(-t / 0.02)
    body = (np.sin(2 * np.pi * np.cumsum(fb) / SR) + 0.45 * np.sin(2 * np.pi * np.cumsum(2 * fb) / SR)) * np.exp(-t / 0.085) * 0.75
    thock = bp(rng.standard_normal(n), 900, 3200) * np.exp(-t / 0.012) * 0.42
    return fade(reverb(x * 0.8 + body + thock, t60=0.55, wet=0.12, bright=3500), 0.002, 0.2)
save("sub_hit", sub_hit(), -7)

# 6) gentle riser (anticipation before the verdict)
def riser(dur=1.1):
    n = int(dur * SR); t = np.linspace(0, 1, n)
    f = 500 * (5000 / 500) ** (t ** 1.3)
    x = sweep_filter(pink(n) * 4, f, q=1.0) * (t ** 2.2)
    return fade(reverb(x, t60=0.4, wet=0.10), 0.05, 0.03)
save("riser", riser(), -12)

# 7) soft "stamp" (verdict seal): 190 Hz knock with harmonics + a filtered-noise thock (audible on a phone)
def stamp(dur=0.36):
    n = int(dur * SR); t = np.arange(n) / SR
    f0 = 190 + 70 * np.exp(-t / 0.012)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    knock = (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)) * np.exp(-t / 0.055)
    thock = bp(rng.standard_normal(n), 1000, 3600) * np.exp(-t / 0.014) * 0.55
    return fade(reverb(knock + thock, t60=0.32, wet=0.12, bright=4500), 0.0005, 0.08)
save("stamp", stamp(), -8)

# 8) short chime for mid-video reveals (the long one is kept for the very end)
save("shimmer_short", shimmer(dur=0.75) * 1.0, -10)

# 9) mouse click for list items: press + release, each a tiny plastic "tac" (noise burst through two body resonances) over a soft thump
def click(dur=0.16):
    n = int(dur * SR); out = np.zeros(n)
    for t0, g, f1, f2 in ((0.0, 1.0, 2300, 4100), (0.068, 0.62, 2700, 4700)):
        m = int(0.045 * SR); t = np.arange(m) / SR
        burst = rng.standard_normal(m) * np.exp(-t / 0.0016)
        body = bp(burst, f1 * 0.8, f1 * 1.25, 2) * 1.0 + bp(burst, f2 * 0.85, f2 * 1.2, 2) * 0.7
        ring = (np.sin(2 * np.pi * f1 * t) * 0.35 + np.sin(2 * np.pi * f2 * t) * 0.2) * np.exp(-t / 0.004)
        thump = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.007) * 0.30
        a = int(t0 * SR); out[a:a + m] += g * (body * 3.0 + ring + thump)
    return fade(reverb(out, t60=0.12, wet=0.06, bright=7000), 0.0003, 0.02)
save("click", click(), -10)
