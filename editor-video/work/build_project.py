"""Single source of truth for the edit: captions, graphics, zooms, sound cues.
usage: build_project.py <edl.json> <outdir> [--theme NAME] [--set key=value ...]
Writes <outdir>/overlay/index.html and <outdir>/project.json
"""
import sys, json, os, re, shutil, html as _html, unicodedata, argparse, bisect

S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
ap = argparse.ArgumentParser(); ap.add_argument("edl"); ap.add_argument("outdir"); ap.add_argument("--theme", default="default")
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
CUTS = [c["out_time"] for c in E["cuts"] if "out_time" in c]
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

# the picture holds on a clean frame under the end card (he is about to put the bottle away after the last word)
FREEZE_AT = te(19, "perfumazo") - 0.055
DUR = FREEZE_AT + float(OPT.get("end_hold", 1.45))

# ---------------------------------------------------------------- caption script
# One line per sentence. "|" separates cards. *words* = accent (may span words). [words] = spoken but not captioned (a title shows them).
# "word~" = the NEXT word is revealed together with this one (fast function-word clusters, numbers);  "~word" = this word waits for the next one.
CAPTIONS = {
 0: "la marca | promete | que este | perfume | dura | [48 horas] | y al final | del video | te~ voy~ a~ decir | si~ eso | es *verdad* | o no",
 1: "esto~ es | [One Million Black de Rabanne el último lanzamiento] | de la | mítica | y famosísima | línea | One~ Million | de perfumes",
 2: "si~ no | usaste | One~ Million | alguna~ vez | en tu vida | es porque | nunca~ fuiste | a~ un *boliche*",
 3: "lo cierto | es~ que | según | Fragrantica | [a 8 de cada 10 personas] | les *encanta* | este perfume",
 4: "me parece | uno~ de~ los | *mejores* | lanzamientos | del año | creo~ que | es el *mejor* | One~ Million | de todos",
 5: "esto~ es | un perfume | *dulce* | *tropical* | y que | se hace | notar | *muchísimo*",
 6: "lo~ que~ sí | te tengo~ que | decir | es~ que | de *Black* | no tiene | mucho | porque | es~ un perfume | que sale | con | un *ananá* | jugoso | y~ a~ la | media hora | se transforma | en~ una | *vainilla* | más cremosa | con la mezcla | de *coco* | y un fondo | de *madera* | tostada | que lo hacen | *espectacular*",
 7: "muy dulce | eso sí | pero | yo~ no~ soy | fan~ de~ los | perfumes *dulces* | y~ eso | lo saben | ustedes | los~ que~ me miran | siempre | pero este | me *conquistó* | de verdad",
 8: "los~ que~ aman | este perfume | dicen~ que | es *adictivo* | y~ que trae | *cumplidos*",
 9: "y~ los~ que~ no | le critican | que~ por~ ahí | puede~ ser | demasiado | *dulce* | *juvenil* | ~y *más de~ lo mismo*",
 10: "lo~ que~ sí | te digo | que~ es | un perfume | 100% | *nocturno* | más tirando | a *frío*",
 11: "con calor | yo lo usaría | solamente | de *noche* | si de día | solamente | si te animás",
 12: "las~ 48 | horas | en la piel | la mayoría | de~ las opiniones | incluida | la mía | habla de~ que | entre | *8~ y~ 10* | horas",
 14: "las~ 48 | horas | se cumplen | pero | solamente | [en la ropa]",
 15: "[sí señores]",
 16: "si~ te~ lo | aplicás | en ropa | te~ va~ a | quedar | *dos días* | impregnado | esta *bestia*",
 17: "me gustaría | que ustedes | me~ dejen~ en~ los | *comentarios* | qué opinan | de este | si lo aman | les gusta | lo dulce | o lo sienten | un~ poco | *empalagoso*",
 18: "personalmente | considero | que está | [aprobadísimo]",
 19: "te tiene~ que | gustar | el ananá | dulce | jugosa | y cremosa | como dije | pero | [un perfumazo]",
}
LEAD = 0.045      # captions land ~1.5 frames before the word's acoustic onset
HOLD = 0.34       # how long a card may linger after its last word when nothing follows
DISPLAY = {"one": "1"}   # on-screen spelling follows the bottle and the graphics: "1 Million"

def build_captions():
    cards = []; lint = []
    for s in sorted({w["sent"] for w in WORDS}):
        script = CAPTIONS.get(s)
        if script is None: raise SystemExit(f"no caption script for sentence {s}: " + " ".join(w["w"] for w in WORDS if w["sent"] == s))
        ws = [w for w in WORDS if w["sent"] == s]; k = 0
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

exec(open(f"{S}/work/plan_graphics.py").read())   # defines the graphic items / zoom / sfx using the helpers above

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
proj = {"src": f"{S}/dl/src/raw.mov", "fps": FPS, "w": 1080, "h": 1920, "segments": E["segments"], "duration": round(DUR, 4), "hflip": True,
        "freeze": {"at": round(FREEZE_AT, 4), "dim": float(OPT.get("end_dim", 0.16))},
        "zoom": ZOOM, "grade": OPT.get("grade", GRADE), "sharpen": float(OPT.get("sharpen", 0.25)), "chroma_defect_period": 120,
        "matte_cache": f"{S}/build/matte_cache",
        "overlay_dir": f"{OUT}/ov_front", "overlay_back_dir": f"{OUT}/ov_back", "audio": f"{OUT}/audio/mix.wav",
        "audio_cfg": {"voice_chain": OPT.get("voice_chain", VOICE), "target_lufs": -14.0, "true_peak": -1.0, "sfx_dir": f"{S}/build/sfx", "end_fade_ms": 130,
                      "pause_duck_db": float(OPT.get("pause_duck_db", 9.0)), "fade_out_ms": 70, "fade_in_ms": 12,
                      # three soft-spoken punchlines stayed ~2 LU under the programme after levelling: ride them up (source seconds)
                      "post_gain": [[17.55, 19.62, 2.0], [115.4, 120.15, 1.7], [136.4, 139.25, 2.0]]},
        "words": [{"w": w["w"], "s": w["s"], "e": w["e"]} for w in WORDS],
        "sfx": sorted(SFX, key=lambda e: e["t"]), "captions": CAPS}
json.dump(proj, open(f"{OUT}/project.json", "w"), ensure_ascii=False, indent=1)
print(f"project: {DUR:.2f}s (speech ends {SPEECH_END:.2f}, picture holds from {FREEZE_AT:.2f}), {len(CAPS)} caption cards, {len(ITEMS)} overlay items, {len(SFX)} sfx, {len(ZOOM)} zoom keys")
