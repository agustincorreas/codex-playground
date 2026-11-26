"""Second-opinion ASR: NVIDIA Parakeet TDT v3 via sherpa-onnx, token timestamps. Usage: transcribe_pk.py <wav16k> <out.json>"""
import os
import sys, json, wave
import numpy as np
import sherpa_onnx

wav, out = sys.argv[1], sys.argv[2]
D = ((os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) + "/models/parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")
rec = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=f"{D}/encoder.int8.onnx", decoder=f"{D}/decoder.int8.onnx", joiner=f"{D}/joiner.int8.onnx",
    tokens=f"{D}/tokens.txt", num_threads=4, sample_rate=16000, feature_dim=80,
    decoding_method="greedy_search", model_type="nemo_transducer")

with wave.open(wav) as f:
    assert f.getframerate() == 16000 and f.getnchannels() == 1
    x = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

# chunk in ~25 s windows with cuts at low-energy points so the model sees comfortable lengths
sr = 16000
def find_cut(lo, hi):
    seg = x[lo:hi]
    win = int(0.05 * sr)
    n = len(seg) // win
    e = (seg[: n * win].reshape(n, win) ** 2).mean(1)
    return lo + int(np.argmin(e)) * win + win // 2

chunks, pos = [], 0
while pos < len(x):
    end = pos + 25 * sr
    if end >= len(x):
        chunks.append((pos, len(x))); break
    cut = find_cut(pos + 18 * sr, end)
    chunks.append((pos, cut)); pos = cut

tokens = []
for a, b in chunks:
    st = rec.create_stream()
    st.accept_waveform(sr, x[a:b])
    rec.decode_stream(st)
    r = st.result
    for tok, ts in zip(r.tokens, r.timestamps):
        tokens.append((tok, a / sr + ts))

# merge sentencepiece-style tokens into words (leading space / ▁ marks a new word)
words = []
for tok, ts in tokens:
    new = tok.startswith(" ") or tok.startswith("▁")
    t = tok.replace("▁", " ")
    if new or not words:
        words.append({"w": t.strip(), "s": round(ts, 3)})
    else:
        words[-1]["w"] += t
json.dump({"words": words, "text": " ".join(w["w"] for w in words)}, open(out, "w"), ensure_ascii=False, indent=1)
print(" ".join(w["w"] for w in words))
