"""Build the edit decision list for the source video from forced-aligned words + the level envelope.

usage: edl.py <config.json> <out_edl.json>
config: {
  "drop": [[first_word_index, last_word_index, "reason"], ...],     # content removals (inclusive word indices)
  "pause": {"sentence": 0.32, "clause": 0.22, "inner": 0.16},       # target silence (s) left at each kind of junction
  "min_removal": 0.17,                                              # do not cut unless at least this much is removed
  "tail_share": 0.58,                                               # share of the kept silence that stays after the previous word
  "thr_db": -46.0,                                                  # level below which audio counts as silence
  "lead_in": 0.10, "lead_out": 0.45
}
Output: segments [{in, out}] (source seconds), cut table, and words mapped to output time.
"""
import os
import sys, json, numpy as np

S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
cfg = json.load(open(sys.argv[1]))
words = json.load(open(f"{S}/analysis/src_words.json"))["words"]
vad = json.load(open(f"{S}/analysis/src_vad.json"))
db = np.array(vad["db"]); HOP = vad["hop"]; WIN = 0.020
DUR = len(db) * HOP + WIN
thr = cfg.get("thr_db", -46.0)
P = cfg["pause"]; MINR = cfg.get("min_removal", 0.17); TS = cfg.get("tail_share", 0.58)

drop = np.zeros(len(words), bool)
for a, b, _ in cfg.get("drop", []): drop[a:b + 1] = True
kept = [i for i in range(len(words)) if not drop[i]]

def t2i(t): return int(np.clip(round((t - WIN / 2) / HOP), 0, len(db) - 1))
def i2t(i): return i * HOP + WIN / 2

def silence_run(t0, t1, min_off=0.09, min_on=0.05, on_margin_db=4.0):
    """Non-speech stretch between two aligned words: from the end of speech after t0 to the speech onset before t1.
    q0 = start of the first run below thr lasting >= min_off (longer than a stop closure) after t0 (or reaching t1);
    q1 = end of the last run below (thr - on_margin) lasting >= min_on before t1 (soft onsets sit lower than thr).
    Everything in between (breaths, clicks, 'eh') is treated as removable because the aligner places no word there."""
    a, b = t2i(t0), t2i(t1)
    if b <= a: return None
    low = db[a:b + 1] < thr
    n = len(low); q0 = None; k = 0
    need = int(round(min_off / HOP))
    while k < n:
        if low[k]:
            e = k
            while e < n and low[e]: e += 1
            if e - k >= need or e == n: q0 = k; break
            k = e
        else: k += 1
    if q0 is None: return None
    low2 = db[a:b + 1] < (thr - on_margin_db)
    need2 = int(round(min_on / HOP)); q1 = None; k = n - 1
    while k >= q0:
        if low2[k]:
            st = k
            while st >= q0 and low2[st]: st -= 1
            if k - st >= need2 or st < q0: q1 = k; break
            k = st
        else: k -= 1
    if q1 is None or q1 <= q0: return None
    return i2t(a + q0) - HOP / 2, i2t(a + q1) + HOP / 2

def junction_kind(prev_word):
    w = prev_word["w"]
    if w[-1] in ".?!": return "sentence"
    if w[-1] in ",;:": return "clause"
    return "inner"

cuts = []      # (cut_out_time, cut_in_time, info)
junctions = []
# head
first = words[kept[0]]
r = silence_run(max(0.0, first["s"] - 1.5), first["s"] + 0.06)
speech_on = r[1] if r else first["s"]
start = max(0.0, speech_on - cfg.get("lead_in", 0.10))
for n in range(len(kept) - 1):
    i, j = kept[n], kept[n + 1]
    wi, wj = words[i], words[j]
    contiguous = (j == i + 1)
    # search for silence between the end of word i and the start of word j
    r = silence_run(wi["e"] - 0.06, wj["s"] + 0.06) if contiguous else None
    kind = junction_kind(wi)
    target = cfg.get("pause_override", {}).get(str(i), P[kind])
    if contiguous:
        if r is None: continue
        q0, q1 = r; sil = q1 - q0
        man = cfg.get("manual", {}).get(str(i))
        if man:
            out_t = man.get("out", q0 + target * TS); in_t = man.get("in", q1 - target * (1 - TS))
            cuts.append((out_t, in_t, {"type": "pause", "kind": kind, "silence": round(sil, 3), "kept": round(target, 3), "manual": True, "after": wi["w"], "before": wj["w"], "wi": i, "wj": j}))
            continue
        junctions.append({"wi": i, "after": wi["w"], "before": wj["w"], "kind": kind, "q0": round(q0, 3), "q1": round(q1, 3), "silence": round(sil, 3)})
        if sil < target + MINR: continue
        out_t = q0 + target * TS; in_t = q1 - target * (1 - TS)
        cuts.append((out_t, in_t, {"type": "pause", "kind": kind, "silence": round(sil, 3), "kept": target, "after": wi["w"], "before": wj["w"], "wi": i, "wj": j}))
    else:
        # content removal: leave after word i the tail of its following silence, enter before word j from its preceding silence
        ra = silence_run(wi["e"] - 0.06, words[i + 1]["s"] + 0.06)
        rb = silence_run(words[j - 1]["e"] - 0.06, wj["s"] + 0.06)
        dropped = " ".join(words[k]["w"] for k in range(i + 1, j))
        man = cfg.get("manual", {}).get(str(i))
        if man:
            cuts.append((man["out"], man["in"], {"type": "content", "kind": kind, "kept": 0.0, "manual": True, "after": wi["w"], "before": wj["w"], "dropped": dropped, "wi": i, "wj": j}))
            continue
        if ra is None or rb is None:
            cuts.append((None, None, {"type": "content", "ERROR": "no silence at junction", "after": wi["w"], "before": wj["w"], "dropped": dropped, "ra": ra, "rb": rb, "wi": i, "wj": j}))
            continue
        tail = min(target * TS, (ra[1] - ra[0]) * 0.8); head = min(target * (1 - TS), (rb[1] - rb[0]) * 0.8)
        out_t = ra[0] + tail; in_t = rb[1] - head
        cuts.append((out_t, in_t, {"type": "content", "kind": kind, "kept": round(tail + head, 3), "sil_a": round(ra[1] - ra[0], 3), "sil_b": round(rb[1] - rb[0], 3),
                                   "after": wi["w"], "before": wj["w"], "dropped": dropped, "wi": i, "wj": j}))
last = words[kept[-1]]
r = silence_run(last["e"] - 0.06, min(DUR, last["e"] + 1.5))
speech_off = r[0] if r else last["e"]
end = min(DUR, speech_off + cfg.get("lead_out", 0.45))

FPS_ = 30.0
snap = lambda t: round(t * FPS_) / FPS_
start = snap(start); end = snap(end)
segs = []; cur = start; table = []
for out_t, in_t, info in cuts:
    if out_t is None: table.append(info); continue
    out_t, in_t = snap(out_t), snap(in_t)
    segs.append({"in": round(cur, 4), "out": round(out_t, 4)})
    info.update(cut_out=round(out_t, 3), cut_in=round(in_t, 3), removed=round(in_t - out_t, 3))
    table.append(info); cur = in_t
segs.append({"in": round(cur, 4), "out": round(end, 4)})

acc = [0.0]
for s in segs: acc.append(acc[-1] + s["out"] - s["in"])
def to_out(t):
    for k, s in enumerate(segs):
        if s["in"] - 1e-6 <= t <= s["out"] + 1e-6: return acc[k] + (t - s["in"])
    return None
wout = []
for i in kept:
    w = words[i]; a = to_out(w["s"]); b = to_out(w["e"])
    wout.append({"i": i, "w": w["w"], "sent": w["sent"], "src_s": w["s"], "src_e": w["e"], "s": None if a is None else round(a, 3), "e": None if b is None else round(b, 3)})
for k, info in enumerate([t for t in table if "cut_out" in t]): info["out_time"] = round(acc[k + 1], 3)
res = {"junctions": junctions, "segments": segs, "duration": round(acc[-1], 3), "cuts": table, "words": wout, "config": cfg}
json.dump(res, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)

print(f"source {DUR:.2f}s -> edit {acc[-1]:.2f}s  ({len(segs)} segments, {len(segs) - 1} cuts, removed {DUR - acc[-1]:.2f}s)")
print(f"head trimmed {start:.2f}s, tail ends at {end:.2f}")
for info in table:
    if "ERROR" in info: print("  !! ", info); continue
    extra = f" DROPPED: «{info['dropped']}»" if info["type"] == "content" else f" silence {info['silence']:.2f}"
    print(f"  @out {info['out_time']:7.2f}  src {info['cut_out']:7.2f}->{info['cut_in']:7.2f}  -{info['removed']:.2f}s  [{info['kind']:8s}] …{info['after']} | {info['before']}…{extra}")
bad = [w for w in wout if w["s"] is None or w["e"] is None]
if bad: print("WORDS TOUCHING A CUT (check!):", [(w["w"], w["src_s"], w["src_e"]) for w in bad])
