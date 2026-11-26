"""Acoustic feasibility of candidate content removals: silence on both sides of each removal (source audio)."""
import os
import sys, json, numpy as np
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
words = json.load(open(f"{S}/analysis/src_words.json"))["words"]
vad = json.load(open(f"{S}/analysis/src_vad.json")); db = np.array(vad["db"]); HOP = vad["hop"]
def lv(a, b): return db[int(a / HOP):max(int(a / HOP) + 1, int(b / HOP))]
def sil(a, b, thr=-46):
    seg = lv(a, b) < thr; best = 0; cur = 0; start = None; bs = None
    for k, v in enumerate(seg):
        if v:
            if cur == 0: start = k
            cur += 1
            if cur > best: best = cur; bs = start
        else: cur = 0
    return (best * HOP, a + (bs or 0) * HOP)
cands = json.loads(sys.argv[1])
for name, a, b in cands:
    pw, fw, lw, nw = words[a - 1], words[a], words[b], words[b + 1] if b + 1 < len(words) else None
    g1 = sil(pw["e"] - 0.05, fw["s"] + 0.05); g2 = sil(lw["e"] - 0.05, (nw["s"] + 0.05) if nw else lw["e"] + 0.6)
    dur = (nw["s"] if nw else lw["e"]) - fw["s"]
    print(f"{name}: remove i{a}-{b} «{' '.join(w['w'] for w in words[a:b+1])}»\n   before: …{words[a-2]['w']} {pw['w']} | gap {fw['s']-pw['e']:.2f}s, longest silence {g1[0]:.2f}s @ {g1[1]:.2f}   after: {lw['w']} | {nw['w'] if nw else 'END'} gap {((nw['s'] if nw else lw['e'])-lw['e']):.2f}s, longest silence {g2[0]:.2f}s @ {g2[1]:.2f}   speech removed ≈ {dur:.2f}s (src {fw['s']:.2f}-{lw['e']:.2f})")
