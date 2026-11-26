"""CTC forced alignment (MMS-300m forced aligner) of a known transcript to audio -> word start/end at 20 ms resolution.
usage: falign.py <wav16k> <transcript.txt> <out.json>
Transcript tokens: display or display|spoken. Lines starting with # ignored. Each line = one sentence."""
import os
import sys, json, re, unicodedata, wave
import numpy as np, torch
from transformers import Wav2Vec2ForCTC

S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
wav, txt, out = sys.argv[1:4]
vocab = json.load(open(f"{S}/models/mms_fa/vocab.json"))
model = Wav2Vec2ForCTC.from_pretrained(f"{S}/models/mms_fa").eval()
torch.set_num_threads(4)

with wave.open(wav) as f:
    assert f.getframerate() == 16000
    x = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
x = (x - x.mean()) / (x.std() + 1e-8)

# emissions in 30 s windows with 2 s overlap context on each side
SR = 16000; WIN = 30 * SR; CTX = 2 * SR
ems = []
pos = 0
with torch.no_grad():
    while pos < len(x):
        a = max(0, pos - CTX); b = min(len(x), pos + WIN + CTX)
        lg = model(torch.from_numpy(x[a:b])[None]).logits[0]
        lp = torch.log_softmax(lg, -1).numpy()
        fr = (b - a) / lp.shape[0]  # samples per frame (~320)
        i0 = int(round((pos - a) / fr)); i1 = int(round((min(len(x), pos + WIN) - a) / fr))
        ems.append(lp[i0:i1]); pos += WIN
E = np.concatenate(ems); T = E.shape[0]
spf = len(x) / T / SR  # seconds per frame

def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z']", "", s)

words = []  # (display, spoken_norm, sentence_idx)
si = 0
for line in open(txt, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"): continue
    for tok in line.split():
        disp, _, spoken = tok.partition("|")
        n = norm(spoken or disp)
        if n: words.append((disp, n, si))
    si += 1

tokens = []; owner = []
for wi, (_, n, _) in enumerate(words):
    for ch in n:
        tokens.append(vocab[ch]); owner.append(wi)
L = len(tokens); B = 0
# Viterbi over the CTC trellis with states: blank0, tok0, blank1, tok1, ..., blankL
NS = 2 * L + 1
NEG = -1e30
dp = np.full(NS, NEG); dp[0] = E[0, B]; dp[1] = E[0, tokens[0]]
bp = np.zeros((T, NS), dtype=np.int8)
tok_arr = np.array(tokens)
emit_idx = np.zeros(NS, dtype=np.int64); emit_idx[1::2] = tok_arr  # blanks -> 0
# skip allowed from token s-2 to token s only if different symbols
can_skip = np.zeros(NS, dtype=bool)
can_skip[3::2] = tok_arr[1:] != tok_arr[:-1]
for t in range(1, T):
    stay = dp
    step = np.concatenate([[NEG], dp[:-1]])
    skip = np.concatenate([[NEG, NEG], dp[:-2]]); skip = np.where(can_skip, skip, NEG)
    cand = np.stack([stay, step, skip])
    arg = cand.argmax(0)
    dp = cand[arg, np.arange(NS)] + E[t, emit_idx]
    bp[t] = arg
s = int(NS - 1 if dp[NS - 1] >= dp[NS - 2] else NS - 2)
path = np.zeros(T, dtype=np.int64)
for t in range(T - 1, -1, -1):
    path[t] = s
    s -= int(bp[t, s])
# per-token frame spans
tok_frames = {}
for t, st in enumerate(path):
    if st % 2 == 1:
        k = st // 2
        if k not in tok_frames: tok_frames[k] = [t, t]
        else: tok_frames[k][1] = t
res = []
for wi, (disp, n, sidx) in enumerate(words):
    ks = [k for k in range(L) if owner[k] == wi]
    f0 = tok_frames[ks[0]][0]; f1 = tok_frames[ks[-1]][1]
    sc = float(np.mean([E[tok_frames[k][0]:tok_frames[k][1] + 1, tokens[k]].max() for k in ks]))
    res.append({"w": disp, "norm": n, "sent": sidx, "s": round(f0 * spf, 3), "e": round((f1 + 1) * spf, 3), "score": round(sc, 2)})
json.dump({"sec_per_frame": spf, "words": res}, open(out, "w"), ensure_ascii=False, indent=1)
print(f"aligned {len(res)} words, {T} frames, {spf * 1000:.2f} ms/frame; low-confidence words:")
for r in res:
    if r["score"] < -2.5: print(f"   {r['s']:7.2f}-{r['e']:7.2f} {r['w']} ({r['score']})")
