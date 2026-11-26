"""Transcribe with faster-whisper large-v3, word timestamps. Usage: transcribe.py <wav> <out.json> [verbatim]"""
import os
import sys, json, wave
import numpy as np
from faster_whisper import WhisperModel

wav, out = sys.argv[1], sys.argv[2]
verbatim = len(sys.argv) > 3 and sys.argv[3] == "verbatim"
MODEL = ((os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) + "/models/fw-large-v3")
model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=4)

prompt = None
if verbatim:
    # nudge whisper to keep disfluencies instead of cleaning them up
    prompt = ("Eh... este... mmm, bueno, o sea, eh, digamos, a ver... es un, es un perfume que, que, eh, "
              "tiene, tiene como, como una salida, ¿no?, este, muy, muy rica. Paco Rabanne, One Million.")

with wave.open(wav) as _f:
    assert _f.getframerate() == 16000 and _f.getnchannels() == 1
    audio = np.frombuffer(_f.readframes(_f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

segments, info = model.transcribe(
    audio, language="es", beam_size=5, word_timestamps=True,
    condition_on_previous_text=False, vad_filter=False,
    initial_prompt=prompt, temperature=[0.0, 0.2, 0.4],
    no_speech_threshold=0.6,
)
res = {"language": info.language, "duration": info.duration, "segments": []}
for s in segments:
    seg = {"start": s.start, "end": s.end, "text": s.text,
           "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob,
           "words": [{"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)} for w in (s.words or [])]}
    res["segments"].append(seg)
    print(f"[{s.start:7.2f} - {s.end:7.2f}] {s.text}", flush=True)
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
