"""Probe source regions: isolated Whisper passes (word timestamps) + VAD segments. usage: probe.py a-b [a-b ...]"""
import os
import sys, json, wave, numpy as np
from faster_whisper import WhisperModel
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
with wave.open(f"{S}/audio/src_16k.wav") as f:
    x = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
vad = json.load(open(f"{S}/analysis/src_vad.json"))
model = WhisperModel(f"{S}/models/fw-large-v3", device="cpu", compute_type="int8", cpu_threads=4)
PROMPT = "Eh... este... mmm, bueno, o sea, eh, a ver... y, y, eh, que, que es un, es un perfume, eh, dulce."
for r in sys.argv[1:]:
    a, b = map(float, r.split("-"))
    print(f"\n=== region {a:.2f}-{b:.2f}")
    print("  VAD speech:", " ".join(f"[{s:.2f}-{e:.2f}]" for s, e, m in vad["speech"] if e > a and s < b))
    clip = x[int(a * 16000): int(b * 16000)]
    for name, kw in (("plain", {}), ("verbatim", {"initial_prompt": PROMPT})):
        segs, _ = model.transcribe(clip, language="es", beam_size=5, word_timestamps=True, condition_on_previous_text=False, temperature=0.0, **kw)
        ws = [w for s in segs for w in (s.words or [])]
        print(f"  {name:8s}:", " ".join(f"{w.word.strip()}({a + w.start:.2f}-{a + w.end:.2f})" for w in ws))
