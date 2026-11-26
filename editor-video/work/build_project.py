"""Single source of truth for the edit: captions, graphics, zooms, sound cues.
usage: build_project.py <edl.json> <outdir> --video <dir with plan.py> [--theme NAME] [--set key=value ...]
The video folder holds everything specific to one video (plan.py: CAPTIONS, AUDIO, END_WORD, plan()); the look lives in blocks.py + the theme.
Writes <outdir>/overlay/index.html and <outdir>/project.json
"""
import sys, json, os, re, shutil, html as _html, unicodedata, argparse, bisect

S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
ap = argparse.ArgumentParser(); ap.add_argument("edl"); ap.add_argument("outdir"); ap.add_argument("--theme", default="default"); ap.add_argument("--video", required=True)
ap.add_argument("--set", action="append", default=[], help="override a plan option, key=value")
A = ap.parse_args()
OPT = {"captions": "on"}
# voice: mono, rumble filter, gentle expander so pauses do not rise with the make-up gain, light tone shaping, two-stage levelling
VOICE = ("pan=mono|c0=c0,highpass=f=85:poles=2,agate=threshold=-52dB:ratio=2:range=-12dB:attack=5:release=150:knee=6dB:detection=rms,"
         "equalizer=f=140:t=q:w=1.0:g=-2.5,equalizer=f=1300:t=q:w=0.8:g=1.5,"
         "acompressor=threshold=-30dB:ratio=3:attack=5:release=160:knee=6dB:makeup=10dB,acompressor=threshold=-16dB:ratio=4:attack=2:release=70:knee=4dB")
# picture: light, natural finishing measured by the colour pass: gentle S-curve with protected whites, skin 4 deg less pink (no LUT, no saturation boost)
GRADE = "curves=master='0/0 0.12/0.105 0.30/0.285 0.55/0.55 0.75/0.762 0.90/0.897 1/0.985',huesaturation=hue=4:colors=r:strength=1"
for kv in A.set:
    k, _, v = kv.partition("="); OPT[k] = v
E = json.load(open(A.edl)); WORDS = E["words"]; FPS = 30
SPEECH_END = E["duration"]                 # end of the spliced footage/audio
_acc = 0.0; CUTS = []
for _s in E["segments"][:-1]:
    _acc += _s["out"] - _s["in"]; CUTS.append(round(_acc - 0.002, 4))   # a hair before the cut frame, so anything clamped to a cut is gone on that frame
OUT = os.path.abspath(A.outdir); os.makedirs(f"{OUT}/overlay", exist_ok=True)

# ---------------------------------------------------------------- word lookup helpers
def _n(s):
    s = unicodedata.normalize("NFD", s.lower()); s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9%]", "", s)
def find(sent, phrase, nth=0):
    """Words (list) of `phrase` inside sentence number `sent` (source sentence index)."""
    toks = [_n(x) for x in phrase.split()]
    ws = [w for w in WORDS if w["sent"] == sent]
    hits = [ws[i:i + len(toks)] for i in range(len(ws) - len(toks) + 1) if all(_n(ws[i + k]["w"]) == toks[k] for k in range(len(toks)))]
    if len(hits) <= nth: raise SystemExit(f"phrase not found in sentence {sent}: {phrase!r}")
    return hits[nth]
def ts(sent, phrase, nth=0): return find(sent, phrase, nth)[0]["s"]      # start time of phrase
def te(sent, phrase, nth=0): return find(sent, phrase, nth)[-1]["e"]     # end time of phrase
def sent_span(sent):
    ws = [w for w in WORDS if w["sent"] == sent]; return ws[0]["s"], ws[-1]["e"]
def next_cut(t):
    k = bisect.bisect_right(CUTS, t + 1e-6); return CUTS[k] if k < len(CUTS) else 1e9

# ---------------------------------------------------------------- the video's own plan (captions script, audio extras, graphics)
VIDEO = os.path.abspath(A.video); CAPTIONS = {}; AUDIO = {}; END_WORD = None
HFLIP = True      # the source is a mirrored selfie (set HFLIP = False in plan.py when the product text already reads correctly)
END_HOLD, END_DIM = 0.45, 0.0     # no closing plate by default: the video ends on his last word (set 1.25 / 0.20 only if a plate is wanted)
EMPH = set()      # words shown in the accent colour when captions are grouped automatically
HIDE = {}         # {sentence: "phrase"}: spoken words covered by a title (no caption)
exec(open(f"{VIDEO}/plan.py").read())
# the picture holds on a clean frame under the end card, just after the last word has finished
_last_e = te(*END_WORD) if END_WORD else WORDS[-1]["e"]
FREEZE_AT = min(_last_e + 0.05, SPEECH_END - 0.04)
DUR = FREEZE_AT + float(OPT.get("end_hold", END_HOLD))

# sentences without a hand-written script are grouped automatically: 1-3 words, <= 16 characters, new card after a pause or punctuation,
# and a function word never closes a card (it waits for the word it belongs to)
FUNC = set("a al con de del e el en la las lo los me mi ni no o por que se su te tu un una y es si muy más".split())
_PROPER = {_n(w["w"]) for k, w in enumerate(WORDS) if w["w"][:1].isupper() and k > 0 and WORDS[k - 1]["w"][-1] not in ".?!" and WORDS[k - 1]["sent"] == w["sent"]}
def auto_script(ws):
    cards = []; cur = []; hid = set()
    hp = HIDE.get(ws[0]["sent"])
    if hp:
        hw = find(ws[0]["sent"], hp); hid = {id(x) for x in hw}
    for k, w in enumerate(ws):
        txt = re.sub(r"[.,;:!?¿¡]", "", w["w"])
        if _n(txt) not in _PROPER: txt = txt.lower()
        if _n(txt) in EMPH: txt = "*" + txt + "*"
        if id(w) in hid: txt = "[" + txt + "]"
        paused = k > 0 and (w["s"] - ws[k - 1]["e"] > 0.28 or ws[k - 1]["w"][-1] in ".,;:!?" or (id(w) in hid) != (id(ws[k - 1]) in hid))
        if id(w) in hid and cur and cur[-1].startswith("["): paused = False
        if cur and (paused or (not txt.startswith("[") and (len(cur) >= 3 or len(" ".join(cur + [txt])) > 16))):
            carry = []
            while not paused and len(cur) > 1 and _n(cur[-1]) in FUNC and len(carry) < 2: carry.insert(0, cur.pop())   # a function word never closes a card
            cards.append(cur); cur = carry
        cur.append(txt)
    if cur: cards.append(cur)
    isf = lambda x: _n(x.strip("[]*")) in FUNC and "*" not in x
    for i in range(len(cards) - 1):                      # a card never ends on a function word: it joins the words that follow
        nxt = cards[i + 1]
        while cards[i] and isf(cards[i][-1]) and not cards[i][-1].startswith("[") and len(nxt) < 4:
            x = cards[i].pop(); nxt.insert(0, "[" + x + "]" if nxt[0].startswith("[") else x)
    cards = [c for c in cards if c]
    out = []
    for c in cards:
        if c[0].startswith("["): out.append("[" + " ".join(x.strip("[]") for x in c) + "]"); continue
        lead = 0
        while lead < len(c) - 1 and _n(c[lead]) in FUNC and "*" not in c[lead]: lead += 1
        out.append(" ".join((x + "~" if j < lead else x) for j, x in enumerate(c)))        # leading function words appear with their word
    return " | ".join(out)
LEAD = 0.045      # captions land ~1.5 frames before the word's acoustic onset
HOLD = 0.34       # how long a card may linger after its last word when nothing follows
DISPLAY = {"one": "1"}   # on-screen spelling follows the bottle and the graphics: "1 Million"

def build_captions():
    cards = []; lint = []
    for s in sorted({w["sent"] for w in WORDS}):
        ws = [w for w in WORDS if w["sent"] == s]; k = 0
        script = CAPTIONS.get(s) or auto_script(ws)
        for raw in [c.strip() for c in script.split("|")]:
            hidden = raw.startswith("[") and raw.endswith("]")
            card = []; em = False
            for tok in raw.strip("[]").split():
                wait = tok.startswith("~"); tok = tok.lstrip("~")
                glue = tok.endswith("~") or tok.endswith("~*"); tok = tok.replace("~", "")
                if tok.startswith("*"): em = True
                this_em = em
                if tok.endswith("*"): em = False
                t = tok.strip("*")
                if k >= len(ws) or _n(ws[k]["w"]) != _n(t):
                    raise SystemExit(f"caption script mismatch in sentence {s}: script {t!r} vs audio {ws[k]['w'] if k < len(ws) else None!r}")
                card.append({"text": DISPLAY.get(_n(t), t), "t": ws[k]["s"] - LEAD, "e": ws[k]["e"], "em": this_em, "glue": glue, "wait": wait}); k += 1
            for i in range(len(card) - 1):                      # "a~ b": b appears with a
                if card[i]["glue"]: card[i + 1]["t"] = card[i]["t"]
            for i in range(len(card) - 2, -1, -1):              # "~a b": a appears with b
                if card[i]["wait"]: card[i]["t"] = card[i + 1]["t"]
            for w in card: w.pop("glue"); w.pop("wait")
            c = {"t0": min(w["t"] for w in card), "t1": card[-1]["e"] + HOLD, "last_e": card[-1]["e"], "words": [] if hidden else card, "sent": s, "hidden": hidden,
                 "text": " ".join(w["text"] for w in card)}
            cards.append(c)
        if k != len(ws): raise SystemExit(f"caption script for sentence {s} does not cover all words ({k}/{len(ws)})")
    cards.sort(key=lambda c: c["t0"])
    for c in cards:                                      # a card whose first word starts right after a hard cut must not show before it
        for cut in CUTS:
            if c["t0"] < cut + 0.004 < c["t0"] + 0.12 and c["last_e"] > cut + 0.05:
                c["t0"] = cut + 0.004
                for w in c["words"]: w["t"] = max(w["t"], cut + 0.004)
    for a, b in zip(cards, cards[1:]):
        a["t1"] = min(a["t1"], b["t0"])
        if 0 < b["t0"] - a["t1"] < 0.13: a["t1"] = b["t0"]                       # no 1-3 frame blinks between cards
    for c in cards:
        cut = next_cut(c["last_e"] - 0.05)
        if c["t1"] > cut - 0.001 and cut > c["t0"] + 0.1: c["t1"] = cut           # a card never straddles a hard cut
        if c["hidden"]: continue
        if c["t1"] - c["t0"] < 0.20: lint.append(f"short card ({c['t1'] - c['t0']:.2f}s): {c['text']!r} @ {c['t0']:.2f}")
        last = c["words"][-1]
        if len(c["words"]) > 1 and c["t1"] - last["t"] < 0.17: lint.append(f"last word flashes ({c['t1'] - last['t']:.2f}s): {c['text']!r} @ {c['t0']:.2f}")
        reveals = sorted({w["t"] for w in c["words"]})
        if any(b - a > 0.38 for a, b in zip(reveals, reveals[1:])): lint.append(f"long inner pause: {c['text']!r} @ {c['t0']:.2f}")
        if len(c["text"]) > 17: lint.append(f"long card ({len(c['text'])} chars): {c['text']!r}")
    if cards and not cards[0]["hidden"]:
        for w in cards[0]["words"]:
            if w["t"] <= cards[0]["t0"] + 1e-6: w["instant"] = True                 # text is already there on frame 0
        if cards[0]["t0"] < 0.12: cards[0]["t0"] = 0.0
    if lint: print("caption lint:"); [print("   -", l) for l in lint]
    return [c for c in cards if not c["hidden"]]

# ---------------------------------------------------------------- html helpers
ITEMS = []; SFX = []; ZOOM = []
def esc(s): return _html.escape(s, quote=True)
def d(**kw):
    """data-attributes string. in_/out map to data-in / data-out."""
    m = {"in_": "in", "out": "out", "anim": "anim", "dur": "dur", "dist": "dist", "ease": "ease", "outanim": "outanim", "outdur": "outdur", "count": "count", "countfmt": "countfmt", "drift": "drift"}
    return " ".join(f'data-{m[k]}="{v:.3f}"' if isinstance(v, float) else f'data-{m[k]}="{v}"' for k, v in kw.items() if v is not None)
def item(t0, t1, body, layer="front", cls=""):
    ITEMS.append(f'<div class="item {cls}" data-t0="{max(0.0, t0):.3f}" data-t1="{t1:.3f}" data-layer="{layer}">{body}</div>')
def asset(rel):
    p = f"{S}/assets/{rel}"
    if not os.path.exists(p): print("  (missing asset)", rel); return None
    return "file://" + p

# ---------------------------------------------------------------- CAPTIONS -> items
CAPS = build_captions()
if OPT["captions"] == "on":
    for c in CAPS:
        spans = "".join(f'<span class="w{" em" if w["em"] else ""}" {d(in_=max(0.0, w["t"]), anim="none" if w.get("instant") else "word", dur=0.10)}>{esc(w["text"])}</span>' for w in c["words"])
        item(c["t0"], c["t1"], f'<div class="cap">{spans}</div>', cls="capitem")

exec(open(f"{S}/work/blocks.py").read())          # reusable blocks (titles, cards, zoom gestures, sounds)
plan()                                            # the video's own sequence of blocks
print("slot layout (name, in, out, width):"); [print("   ", l) for l in LAYOUT]

# ---------------------------------------------------------------- sanity: no element may start leaving before it has finished entering
for it in ITEMS:
    for m in re.finditer(r'data-in="([\d.]+)"[^>]*?data-dur="([\d.]+)"[^>]*?data-out="([\d.]+)"', it):
        tin, dur, tout = map(float, m.groups())
        if tin + dur > tout + 1e-6: print(f"  !! element enters {tin:.2f}+{dur:.2f}s but leaves at {tout:.2f}: {it[:90]}...")
# ---------------------------------------------------------------- write html + project
theme_css = open(f"{S}/work/theme_{A.theme}.css").read()
page = f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://{S}/build/fonts/fonts.css">
<style>{open(f"{S}/work/base.css").read()}\n{theme_css}</style></head>
<body><div id="stage">{''.join(ITEMS)}</div>
<script>{open(f"{S}/build/overlay/runtime.js").read()}</script></body></html>"""
open(f"{OUT}/overlay/index.html", "w").write(page)
ZOOM.sort(key=lambda z: z["t"])
proj = {"src": f"{S}/dl/src/raw.mov", "fps": FPS, "w": 1080, "h": 1920, "segments": E["segments"], "duration": round(DUR, 4), "hflip": HFLIP,
        "freeze": {"at": round(FREEZE_AT, 4), "dim": float(OPT.get("end_dim", END_DIM))},
        "zoom": ZOOM, "grade": OPT.get("grade", GRADE), "sharpen": float(OPT.get("sharpen", 0.25)), "chroma_defect_period": 120,
        "matte_cache": f"{S}/build/matte_cache",
        "overlay_dir": f"{OUT}/ov_front", "overlay_back_dir": f"{OUT}/ov_back", "audio": f"{OUT}/audio/mix.wav",
        "audio_cfg": {"voice_chain": OPT.get("voice_chain", VOICE), "target_lufs": -14.0, "true_peak": -1.0, "sfx_dir": f"{S}/build/sfx", "end_fade_ms": 130, "pause_duck_soft_db": 4.0,
                      "pause_duck_db": float(OPT.get("pause_duck_db", 9.0)), "fade_out_ms": 70, "fade_in_ms": 12, **AUDIO},
        "words": [{"w": w["w"], "s": w["s"], "e": w["e"]} for w in WORDS],
        "sfx": sorted(SFX, key=lambda e: e["t"]), "captions": CAPS}
json.dump(proj, open(f"{OUT}/project.json", "w"), ensure_ascii=False, indent=1)
print(f"project: {DUR:.2f}s (speech ends {SPEECH_END:.2f}, picture holds from {FREEZE_AT:.2f}), {len(CAPS)} caption cards, {len(ITEMS)} overlay items, {len(SFX)} sfx, {len(ZOOM)} zoom keys")
