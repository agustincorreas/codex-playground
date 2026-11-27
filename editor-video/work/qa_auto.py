"""Automatic QA of a rendered project: everything the human-style reviewers kept finding, as measurements.
usage: qa_auto.py <projdir> <edl.json> [--asr]      (run after make.sh; exits 1 if any check FAILS)
Checks: container + loudness, word integrity (forced alignment, optional second transcription), gain constant on every word,
SFX margin under the voice, cuts (no duplicate frames, no second jump after a cut), caption cards, cards hidden behind the speaker.
"""
import os
import sys, json, subprocess, re, unicodedata, difflib
import numpy as np, soundfile as sf
from scipy.signal import lfilter
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pd = os.path.abspath(sys.argv[1]); E = json.load(open(sys.argv[2])); ASR = "--asr" in sys.argv
P = json.load(open(f"{pd}/project.json")); FPS = P["fps"]; SR = 48000
V = f"{pd}/out.mp4"; R = []
def res(ok, name, detail):
    ok = None if ok is None else bool(ok); R.append((ok, name, detail)); print(("PASS " if ok is True else "WARN " if ok is None else "FAIL ") + name + ": " + detail, flush=True)

# ---- container + loudness
pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", V], capture_output=True, text=True).stdout)
vs = [s for s in pr["streams"] if s["codec_type"] == "video"][0]; au = [s for s in pr["streams"] if s["codec_type"] == "audio"][0]
dv, da = float(vs["duration"]), float(au["duration"])
res(vs["codec_name"] == "h264" and vs["pix_fmt"] == "yuv420p" and vs["r_frame_rate"] == "30/1" and (vs["width"], vs["height"]) == (1080, 1920) and abs(dv - da) < 0.06,
    "contenedor", f"{vs['codec_name']} {vs['width']}x{vs['height']} {vs['r_frame_rate']} {vs['pix_fmt']}; video {dv:.2f}s audio {da:.2f}s; {int(pr['format']['size']) / 1e6:.0f} MB")
lo = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", V, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
lo = lo[lo.rfind("Summary:"):]; I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", lo).group(1)); TP = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", lo).group(1))
res(abs(I + 14) <= 0.6 and TP <= -0.9, "sonoridad", f"{I:.1f} LUFS, pico real {TP:.1f} dBTP (objetivo -14 / -1)")
res(dv <= 90.5 or None, "duración", f"{dv:.1f} s (regla general: hasta 90 s; tope 180 s)") if dv <= 180 else res(False, "duración", f"{dv:.1f} s supera el tope de 180 s")

# ---- word integrity
src = json.load(open(f"{S}/analysis/src_words.json"))["words"]
toks = []
for line in [l.strip() for l in open(f"{S}/work/src_transcript.txt") if l.strip() and not l.startswith("#")]: toks += line.split()
os.makedirs(f"{pd}/qa", exist_ok=True)
open(f"{pd}/qa/kept.txt", "w").write(" ".join(toks[w["i"]] for w in E["words"]) + "\n")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{pd}/audio/voice_final.wav", "-ac", "1", "-ar", "16000", f"{pd}/qa/voice16k.wav"], check=True)
subprocess.run(["python3", "-I", f"{S}/work/falign.py", f"{pd}/qa/voice16k.wav", f"{pd}/qa/kept.txt", f"{pd}/qa/align.json"], check=True, capture_output=True)
al = json.load(open(f"{pd}/qa/align.json"))["words"]
ds = np.array([a["s"] - w["s"] for a, w in zip(al, E["words"])])
drops = [(w["w"], round(w["s"], 2)) for a, w in zip(al, E["words"]) if a["score"] < src[w["i"]]["score"] - 1.5]
res(len(al) == len(E["words"]) and not drops and np.abs(ds).max() < 0.15, "palabras enteras",
    f"{len(al)}/{len(E['words'])} alineadas; desfase mediano {np.median(ds) * 1000:.0f} ms, máx {np.abs(ds).max() * 1000:.0f} ms; caídas de confianza: {drops or 'ninguna'}")
if ASR:
    subprocess.run(["python3", "-I", f"{S}/work/transcribe.py", f"{pd}/qa/voice16k.wav", f"{pd}/qa/asr.json"], check=True, capture_output=True)
    def norm(s):
        s = unicodedata.normalize("NFD", s.lower()); s = "".join(c for c in s if unicodedata.category(c) != "Mn"); return re.sub(r"[^a-z0-9% ]", " ", s).split()
    hyp = norm(" ".join(s["text"] for s in json.load(open(f"{pd}/qa/asr.json"))["segments"])); ref = norm(" ".join(w["w"] for w in E["words"]))
    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    dif = [f"{' '.join(ref[i1:i2])!r}→{' '.join(hyp[j1:j2])!r}" for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal"]
    res(True if sm.ratio() > 0.985 else None, "segunda transcripción", f"coincidencia {sm.ratio():.3f}; diferencias (revisar que no caigan en un empalme): {dif or 'ninguna'}")

# ---- gain on every word + SFX margins
v, _ = sf.read(f"{pd}/audio/voice_final.wav"); mp, _ = sf.read(f"{pd}/audio/mix_pre.wav"); x, _ = sf.read(f"{pd}/audio/src_processed.wav")
if x.ndim > 1: x = x.mean(1)
vm = v.mean(1); n = min(len(v), len(mp)); sfx = mp[:n] - v[:n]
A = P["audio_cfg"]; FO = int(A.get("fade_out_ms", 70) / 1000 * SR); FI = int(A.get("fade_in_ms", 12) / 1000 * SR); parts = []
for k, s in enumerate(P["segments"]):
    c = x[int(round(s["in"] * SR)):int(round(s["out"] * SR))].copy()
    if k > 0: c[:FI] *= np.sin(np.linspace(0, np.pi / 2, FI)) ** 2
    if k < len(P["segments"]) - 1: c[-FO:] *= np.cos(np.linspace(0, np.pi / 2, FO)) ** 2
    parts.append(c)
y = np.concatenate(parts); rms = lambda a: 20 * np.log10(np.sqrt((a ** 2).mean()) + 1e-9); m40 = int(0.04 * SR); bad = []; gs = []
for w in P["words"]:
    a, b = int(w["s"] * SR), int(w["e"] * SR)
    if b - a < int(0.03 * SR) or b > len(y) or b > len(vm): continue
    g = rms(vm[a:b]) - rms(y[a:b]); gs.append(g)
    d = min(rms(vm[a:a + m40]) - rms(y[a:a + m40]), rms(vm[b - m40:b]) - rms(y[b - m40:b])) - g
    if d < -1.5: bad.append((w["w"], round(w["s"], 2), round(d, 1)))
res(not bad, "ganancia en palabras", f"{len(gs)} palabras; inicio/final atenuados >1,5 dB: {bad or 'ninguno'}")
def kw(sig):
    return lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585], sig, axis=0), axis=0)
def trk(sig):
    p = (kw(sig) ** 2).sum(1); nn = int(0.1 * SR); return -0.691 + 10 * np.log10(np.convolve(p, np.ones(nn) / nn, mode="same") + 1e-12)
kv, ks = trk(v[:n]), trk(sfx); loud = []
for e in P["sfx"]:
    a = int(max(0, e["t"] - e.get("pre", 0)) * SR); i = a + int(np.argmax(ks[a:min(n, a + int(1.2 * SR))]))
    if kv[i] > -30 and kv[i] - ks[i] < 7.0 and kv[i] > -19.5: loud.append((e["name"], e["t"], round(float(kv[i] - ks[i]), 1)))
res(not loud, "efectos bajo la voz", f"{len(P['sfx'])} efectos; con menos de 7 dB de margen sobre voz presente: {loud or 'ninguno'}")

# ---- picture: duplicates, second jump after cuts
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", V, "-vf", "scale=135:240,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, 240, 135).astype(np.int16); d = np.abs(np.diff(fr, axis=0)).mean((1, 2))
acc = 0; cuts = []
for s in E["segments"][:-1]: acc += s["out"] - s["in"]; cuts.append(int(round(acc * FPS)))
fz = int(P["freeze"]["at"] * FPS) if P.get("freeze") else len(fr)
dup = [int(i + 1) for i in np.where(d[:fz - 2] < 0.25)[0]]
res(not dup, "cuadros duplicados", f"{dup[:8] or 'ninguno'} antes del cuadro congelado")
def _second(c):     # the splice lands on frame c or c+1 (source frame times are floored): find it, then look at the frame after it
    j = c - 1 if d[c - 1] >= d[c] else c
    return j + 1 < len(d) and d[j + 1] > 0.55 * d[j] and d[j + 1] > 16 and round(float(d[j + 1]), 1)
second = [(c, _second(c)) for c in cuts if c < len(d) and _second(c)]
res(not second, "cortes limpios", f"{len(cuts)} cortes en cuadros {cuts}; segundo salto tras el corte: {second or 'ninguno'}")

# ---- captions
C = P["captions"]; tc = [c / FPS for c in cuts]
short = [(c["text"], round(c["t0"], 2), round(c["t1"] - c["t0"], 2)) for c in C if c["t1"] - c["t0"] < 0.27]
strad = [(c["text"], round(c["t0"], 2)) for c in C for t in tc if c["t0"] < t - 0.02 and c["t1"] > t + 0.001]
longc = [c["text"] for c in C if len(c["text"]) > 17]
res(not strad, "subtítulos y cortes", f"tarjetas que cruzan un corte: {strad or 'ninguna'}")
res(True if not short and not longc else None, "subtítulos legibles", f"{len(C)} tarjetas; <0,27 s: {short or 'ninguna'}; >17 caracteres: {longc or 'ninguna'}")

# ---- cards hidden behind the speaker
of = f"{pd}/out.occlusion.json"
if os.path.exists(of):
    oc = {int(k): val for k, val in json.load(open(of)).items()}; runs = []; start = None; prev = None; peak = 0
    for k in sorted(oc):
        hid = oc[k] > 0.18
        if hid and (start is None or k != prev + 1): 
            if start is not None and prev - start >= 12: runs.append((round(start / FPS, 1), round(prev / FPS, 1), round(peak, 2)))
            start = k; peak = 0
        if hid: prev = k; peak = max(peak, oc[k])
        elif start is not None:
            if prev - start >= 12: runs.append((round(start / FPS, 1), round(prev / FPS, 1), round(peak, 2)))
            start = None
    if start is not None and prev - start >= 12: runs.append((round(start / FPS, 1), round(prev / FPS, 1), round(peak, 2)))
    res(True if not runs else None, "tarjetas tapadas", f"tramos (inicio, fin, parte oculta) con más del 18 % de la tarjeta detrás del orador por ≥0,4 s: {runs or 'ninguno'}")
fails = [r for r in R if r[0] is False]; warns = [r for r in R if r[0] is None]
json.dump([{"ok": r[0], "check": r[1], "detail": r[2]} for r in R], open(f"{pd}/qa/report.json", "w"), ensure_ascii=False, indent=1)
print(f"\nRESULTADO: {len(R) - len(fails) - len(warns)} ok, {len(warns)} avisos, {len(fails)} fallas")
sys.exit(1 if fails else 0)
