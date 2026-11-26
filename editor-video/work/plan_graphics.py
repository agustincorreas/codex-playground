# Graphic plan (exec'd inside build_project.py; uses item(), d(), ts(), te(), sent_span(), next_cut(), asset(), ZOOM, SFX, OPT, DUR, FREEZE_AT, CUTS, E, S).
# Grammar borrowed from the creator's reference edit and refined:
#   - captions, keyword titles and the product lockup share ONE anchor (centre x~490, baseline ~y=1290); captions hide while a title is up
#   - information lives in ONE slim slot top-left, over the shelves and BEHIND the speaker (person matte): never on his face, never on the bottle
#   - punch-ins: eased pop on a key word, then a slow linear release (resets only on hard cuts)
#   - no graphic or caption straddles a hard cut; sounds only on entrances, kept well under the voice
import math
F = 1 / 30.0
W_, H_ = 1080, 1920

# ===================================================================================================================== ZOOM
AX, AY = 610, 690                      # default zoom anchor (screen coords of the un-mirrored picture): between the eyes in most takes
def zkey(t, s, ease="cut", ax=AX): ZOOM.append({"t": round(t, 4), "s": s, "ax": ax, "ay": AY, "ease": ease})
def gesture(t, s, pop=0.30, hold=0.5, release=2.0, until_cut=False, ax=AX):
    """Eased pop to scale s at time t, hold, then an eased release to 1.0 (or snap back on the next cut).
    ax moves the anchor toward the right edge when the bottle is held there, so the push never crops the product."""
    zkey(t, 1.0, "cut", ax); zkey(t + pop, s, "out", ax)
    cut = next_cut(t)
    if until_cut or t + pop + hold + 0.4 > cut:
        zkey(cut - 0.0005, s * 1.012 if until_cut else s, "linear", ax); zkey(cut, 1.0, "cut")
    else:
        end = min(t + pop + hold + release, cut)
        zkey(t + pop + hold, s, "cut", ax); zkey(end, 1.0, "inout", ax)
zkey(0.0, 1.10, ax=980); zkey(0.40, 1.0, "out", ax=980)                   # opening settle (the reference opens 1.23 -> 1.00 in 10 frames)
gesture(ts(0, "48 horas") - 0.05, 1.13, hold=0.9, release=2.2, ax=980)     # the hook number (bottle at the right edge: anchor there)
gesture(ts(2, "nunca fuiste") - 0.05, 1.11, until_cut=True, ax=980)        # punchline
gesture(ts(4, "es el mejor") - 0.05, 1.09, until_cut=True)
gesture(ts(6, "espectacular") - 0.05, 1.09, hold=0.4, release=1.6)
gesture(ts(7, "me conquistó") - 0.05, 1.10, until_cut=True)
gesture(ts(11, "si te animás") - 0.05, 1.07, until_cut=True)                # the dare
gesture(ts(14, "en la ropa") - 0.05, 1.12, hold=1.2, release=2.8)          # the pay-off
zkey(ts(19, "pero"), 1.0, "cut"); zkey(DUR, 1.12, "inout")                # outro push-in that keeps moving over the held end frame
ZOOM.sort(key=lambda z: z["t"])
def zoom_sa(t):
    """(scale, anchor x) at time t — mirrors render.py's interpolation."""
    ks = ZOOM
    if t <= ks[0]["t"]: return ks[0]["s"], ks[0]["ax"]
    for a, b in zip(ks, ks[1:]):
        if t < b["t"]:
            if b["ease"] == "cut": return a["s"], a["ax"]
            u = (t - a["t"]) / max(1e-9, b["t"] - a["t"])
            u = {"linear": u, "inout": u * u * (3 - 2 * u), "out": 1 - (1 - u) ** 3}[b["ease"]]
            return math.exp(math.log(a["s"]) + (math.log(b["s"]) - math.log(a["s"])) * u), a["ax"] + (b["ax"] - a["ax"]) * u
    return ks[-1]["s"], ks[-1]["ax"]

# ===================================================================================================================== LAYOUT HELPERS
SIL = json.load(open(f"{S}/analysis/{OPT.get('silhouette', 'silhouette_v5.json')}"))
def person_left(t0, t1, y0, y1, pct=4):
    """Left-most x of the speaker on screen (un-mirrored picture, after zoom) for rows y0..y1 during [t0,t1]; free space is x < this."""
    rows = SIL["rows"]; vals = []
    for smp in SIL["samples"]:
        if smp["t"] < t0 - 0.15 or smp["t"] > t1 + 0.15: continue
        s, ax = zoom_sa(smp["t"]); best = 99999
        for y, xr in zip(rows, smp["right"]):          # silhouette was measured on the mirrored source: screen x = 1080 - source x
            if xr < 0: continue
            ys = AY + s * (y - AY)
            if y0 - 10 <= ys <= y1 + 10: best = min(best, ax + s * ((W_ - xr) - ax))
        if best < 99999: vals.append(best)
    if not vals: return 380
    vals.sort(); return vals[min(len(vals) - 1, int(len(vals) * pct / 100))]
LEFT, TOP = 30, 214
WIDTHS = [212, 240, 270, 300]          # the slot has four widths only, so card edges do not wander
LAYOUT = []
def column(t_in, t_out, y0, y1, w_max=300):
    free = person_left(t_in, t_out, y0, y1) - 18 - LEFT
    return max([w for w in WIDTHS if w <= min(free, w_max)] or [WIDTHS[0]])
def out_on_cut(t_out, outdur=0.20):
    """No element straddles a hard cut: if its exit would cross one, it finishes exactly on the cut."""
    for c in CUTS:
        if t_out - 0.45 < c < t_out + outdur + 0.02: return c - outdur - 0.005
    return t_out
def card(t_in, t_out, inner, h_est, y=TOP, cls="glass pad", layer="back", w_max=300, instant=False, name=""):
    """Slim glass card, top-left, behind the speaker; width follows the free column next to him for the time it is up."""
    t_out = out_on_cut(t_out)
    w = column(t_in, t_out, y, y + h_est, w_max=w_max)
    body = f'<div class="abs {cls}" style="left:{LEFT}px;top:{y}px;width:{w}px" {d(in_=t_in, anim="none" if instant else "up", dur=0.36, dist=30, out=t_out, outanim="down", outdur=0.20)}>{inner}</div>'
    item(t_in, t_out + 0.3, body, layer=layer)
    LAYOUT.append((name, round(t_in, 2), round(t_out, 2), w))
    return w, t_out

STAR = '<svg viewBox="0 0 24 24" width="32" height="32"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" fill="{fill}"/></svg>'
def stars(value, t0):
    out = ""
    for i in range(5):
        frac = max(0.0, min(1.0, value - i))
        inner = (STAR.format(fill="rgba(255,255,255,.24)") +
                 f'<div style="position:absolute;left:0;top:0;width:{frac * 32:.1f}px;height:32px;overflow:hidden">{STAR.format(fill="var(--gold)")}</div>')
        out += f'<div style="position:relative;width:32px;height:32px" {d(in_=t0 + i * 0.05, anim="pop", dur=0.26)}>{inner}</div>'
    return f'<div style="display:flex;gap:3px">{out}</div>'
ICON = {
 "check": '<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.6 4.6L19 7.5"/></svg>',
 "cross": '<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2.8" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
 "bubble": '<svg viewBox="0 0 48 48" width="{s}" height="{s}" fill="none" stroke="var(--gold)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M41 23c0 8.3-7.6 15-17 15-2.3 0-4.5-.4-6.5-1.1L8 40l2.4-7.3C8.3 30 7 26.6 7 23 7 14.7 14.6 8 24 8s17 6.7 17 15z"/></svg>',
}
def icon(name, s=44): return ICON[name].replace("{s}", str(s))
# sound: K-weighted 100 ms loudness targets against a -14 LUFS voice whose peaks reach about -9 LUFS. Tent-pole cues sit ~9 dB under those peaks,
# card/note cues ~12 dB under (the reference mixes its effects at voice level; we stay discreet but audible on a phone speaker).
def snd(t, name, k100=-21.0, **kw): SFX.append({"t": round(max(0.0, t), 3), "name": name, "k100": k100, **kw})
CARD_SND, POP_SND = -21.0, -20.0
def title_out(sent, phrase, gap=0.22):
    """Titles leave just before the next caption card appears."""
    return ts(sent, phrase) - gap

# ===================================================================================================================== B0 — HOOK TAG (frame 0 -> first cut)
# The open question sits in the card slot from the very first frame and comes back later as the scoreboard.
t_out = CUTS[0] - 0.02
card(0.0, t_out, '<div class="kicker gold pk" style="margin-bottom:6px">¿Dura</div><div class="tag-q">48 h?</div>', 150, instant=True, name="hook tag")

# ===================================================================================================================== B1 — HOOK NUMBER
t = ts(0, "48 horas"); t_out = title_out(0, "y al final")
item(t - 0.05, t_out + 0.25, f'''
 <div class="center" style="left:-50px;top:1052px"><div class="titlebox">
   <div class="glow" {d(in_=t - 0.03, anim="fade", dur=0.3, out=t_out, outanim="fade", outdur=0.18)}></div>
   <div class="kw-num goldtext" {d(in_=t - 0.03, anim="scale", dur=0.42, out=t_out, outanim="down", outdur=0.18)}>48</div><br>
   <div class="kw-lab pill" {d(in_=t + 0.10, anim="up", dist=18, dur=0.30, out=t_out, outanim="down", outdur=0.18)}>Horas</div>
 </div></div>''', cls="kw")
snd(t - 0.03, "sub_hit", -19.0, hp=38, max_peak_db=-9.0); snd(t - 0.01, "shimmer_short", -21.0)

# ===================================================================================================================== B2 — NAME LOCKUP (held ~3 s like the reference lockups)
t = ts(1, "One Million Black"); tb = ts(1, "Black"); tr = ts(1, "de Rabanne"); t_out = title_out(1, "de la mítica")
item(t - 0.05, t_out + 0.25, f'''
 <div class="center lockup" style="left:-130px;top:1056px">
   <div class="glow" style="width:880px;margin-left:-440px" {d(in_=t - 0.03, anim="fade", dur=0.3, out=t_out, outanim="fade", outdur=0.18)}></div>
   <div class="lk-main" {d(in_=t - 0.03, anim="up", dist=44, dur=0.36, out=t_out, outanim="down", outdur=0.18)}>1 MILLION</div>
   <div class="lk-script goldtext" {d(in_=tb - 0.03, anim="up", dist=30, dur=0.36, out=t_out, outanim="down", outdur=0.18)}>Black</div>
   <div class="lk-kick pill" {d(in_=tr - 0.03, anim="up", dist=14, dur=0.30, out=t_out, outanim="fade", outdur=0.16)}>Rabanne&nbsp;·&nbsp;<b>Lanzamiento 2026</b></div>
 </div>''', cls="lk")
snd(t - 0.05, "whoosh_soft", -19.0, pre=0.22)

# B2b — where it comes from: the original bottle (Fragrantica picture) on "la mítica y famosísima línea One Million"
t = ts(1, "de la mítica") - 0.05; t_out = sent_span(1)[1] + 0.22
card(t, t_out, f'''<div class="saga1"><img src="{asset("fragrantica/bottle_1-million.png")}" {d(in_=t + 0.08, anim="none", drift="0,-2,0.010")}>
   <div class="saga-name">1 Million</div><div class="saga-yr">Desde 2008</div></div>''', 470, w_max=240, name="saga")
snd(t, "whoosh_short", CARD_SND, pre=0.16)

# ===================================================================================================================== B3 — "boliche" (stock picture)
t = ts(2, "boliche") - 0.06; t_out = out_on_cut(sent_span(2)[1] + 0.60)
club = asset("stock/final/nightclub.jpg")
if club:
    w = column(t, t_out, TOP, TOP + 300, w_max=270)
    item(t, t_out + 0.3, f'''<div class="abs photo" style="left:{LEFT}px;top:{TOP}px;width:{w}px;height:{int(w * 1.12)}px;transform-origin:40% 40%" {d(in_=t, anim="scale", dur=0.36, out=t_out, outanim="shrink", outdur=0.2)}>
      <img src="{club}" style="width:118%;height:118%;object-fit:cover;margin:-7% 0 0 -3%" {d(in_=t, anim="none", drift="-6,2,0.016")}></div>''', layer="back")
    snd(t, "pop_soft", POP_SND, pan=-0.25)

# ===================================================================================================================== B4 — FRAGRANTICA rating (backs his own verdict)
t = max(ts(4, "uno de los") - 0.05, sent_span(2)[1] + 0.90); t_out = sent_span(4)[1] + 0.25
card(t, t_out, f'''
   <div class="kicker gold pk">Fragrantica</div>
   <div class="rate"><span class="rate-num goldtext" {d(in_=t + 0.12, anim="fade", dur=0.34, count="3.6,4.3")}>4,3</span><span class="rate-of">/ 5</span></div>
   {stars(4.3, t + 0.22)}
   <div class="rate-votes" {d(in_=t + 0.45, anim="fade", dur=0.3)}>+1.800 votos</div>''', 300, name="rating")
snd(t, "whoosh_short", CARD_SND, pre=0.16)

# ===================================================================================================================== B7 — NOTES (Fragrantica note pictures as medallions: top note, heart pair, base)
t_an, t_va, t_co, t_ma = ts(6, "ananá"), ts(6, "vainilla"), ts(6, "coco"), ts(6, "madera")
t_end = sent_span(6)[1] + 0.30
MED = 212
def medal(img, kick, name, t, t_out, slot, pan=-0.3, sound="pop_soft"):
    src = asset(img)
    if not src: return
    w = column(t, t_out, TOP + slot * 330, TOP + slot * 330 + 300, w_max=300)
    x = LEFT + max(0, (min(w, 270) - MED) // 2); y = TOP + slot * 330
    item(t - 0.08, t_out + 0.3, f'''<div class="abs medal" style="left:{x}px;top:{y}px" {d(in_=t - 0.05, anim="pop", dur=0.36, out=t_out, outanim="shrink", outdur=0.18)}>
        <img src="{src}" style="transform:scale(1.06)" {d(in_=t - 0.05, anim="none", drift="0,0,0.014")}></div>''', layer="back")
    item(t - 0.08, t_out + 0.3, f'''<div class="abs note-lab" style="left:{x - 44}px;top:{y + MED + 12}px;width:{MED + 88}px" {d(in_=t + 0.06, anim="up", dist=16, dur=0.3, out=t_out, outanim="fade", outdur=0.14)}>
        <div class="kicker gold">{kick}</div><div class="note-name">{name}</div></div>''', layer="back")
    snd(t - 0.05, sound, POP_SND, pan=pan)
medal("fragrantica/note_pineapple.png", "Salida", "Ananá", t_an, t_va - 0.14, 0)
medal("fragrantica/note_vanilla.png", "Corazón", "Vainilla", t_va, t_ma - 0.14, 0, sound="pop_high")
medal("fragrantica/note_coconut.png", "Corazón", "Coco", t_co, t_ma - 0.14, 1)
medal("fragrantica/note_ebony-wood.png", "Fondo", "Madera", t_ma, t_end, 0, sound="pop_high")

# ===================================================================================================================== B9 — FANS vs CRITICS (one card, two halves; every line is previewed dim and lights up on its word)
def li(ic, txt, ti, t_card):
    return (f'<div class="li"><div class="li-dim" {d(in_=t_card + 0.18, anim="fade", dur=0.3)}>{icon(ic, 24)}<span>{txt}</span></div>'
            f'<div class="li-on" {d(in_=ti - 0.04, anim="fade", dur=0.20)}>{icon(ic, 24)}<span>{txt}</span></div></div>')
t = ts(8, "dicen que") - 0.05; t_out = sent_span(9)[1] + 0.30; t_con = ts(9, "le critican") - 0.05
card(t, t_out, f'''<div class="kicker gold pk">A favor</div>{li("check", "Adictivo", ts(8, "adictivo"), t)}{li("check", "Trae cumplidos", ts(8, "cumplidos"), t)}
   <div class="sec"><div class="kslot"><div class="kicker kick-dim" {d(in_=t + 0.18, anim="fade", dur=0.3, out=t_con, outanim="fade", outdur=0.12)}>En contra</div><div class="kicker" {d(in_=t_con, anim="fade", dur=0.2)}>En contra</div></div>
   {li("cross", "Demasiado dulce", ts(9, "demasiado"), t)}{li("cross", "Juvenil", ts(9, "juvenil"), t)}{li("cross", "Más de lo mismo", ts(9, "más de lo mismo"), t)}</div>''', 520, name="pros/cons")
snd(t, "whoosh_short", CARD_SND, pre=0.16)

# ===================================================================================================================== B10 — WHEN TO WEAR IT (stock pictures: moon, snowy pines)
t = ts(11, "con calor") + 0.10; t_out = out_on_cut(te(11, "animás") + 0.30)
w = column(t, t_out, TOP, TOP + 360)
tile = lambda img, big, small, ti: (f'<div class="tile" {d(in_=ti, anim="up", dist=22, dur=0.32, out=t_out, outanim="down", outdur=0.2)}><img src="{asset(img)}" {d(in_=ti, anim="none", drift="0,0,0.012")}>'
                                    f'<div class="shade"></div><div class="txt"><b>{big}</b><span>{small}</span></div></div>')
item(t, t_out + 0.3, f'<div class="abs tiles" style="left:{LEFT}px;top:{TOP}px;width:{w}px">{tile("stock/final/night.jpg", "Noche", "100% nocturno", t)}{tile("stock/final/cold.jpg", "Frío", "Otoño–invierno", t + 0.30)}</div>', layer="back")
LAYOUT.append(("when", round(t, 2), round(t_out, 2), w))
snd(t, "whoosh_short", CARD_SND, pre=0.16)

# ===================================================================================================================== B11 — THE 48 h VERDICT (the hook tag returns as a scoreboard)
t = ts(12, "48 horas") - 0.05; t_out = te(15, "señores") + 0.30
t_skin = ts(12, "8 y 10") - 0.04; t_cl = ts(14, "en la ropa") - 0.04
card(t, t_out, f'''
   <div class="kicker gold pk">¿48 horas?</div>
   <div class="dur-row" {d(in_=t + 0.14, anim="fade", dur=0.25)}><div class="dur-head"><div class="dur-lab">En piel</div></div>
      <div class="dur-slot"><b class="dur-val q" {d(in_=t + 0.20, anim="fade", dur=0.25, out=t_skin - 0.02, outanim="fade", outdur=0.12)}>?</b><b class="dur-val on" {d(in_=t_skin, anim="up", dist=10, dur=0.26)}>8–10 h</b></div>
      <div class="bar-track"><div class="bar-fill grow" style="width:20%" {d(in_=t_skin, anim="grow", dur=0.6)}></div></div></div>
   <div class="dur-row" {d(in_=t + 0.22, anim="fade", dur=0.25)}><div class="dur-head"><div class="dur-lab">En ropa</div></div>
      <div class="dur-slot"><b class="dur-val q" {d(in_=t + 0.28, anim="fade", dur=0.25, out=t_cl + 0.20, outanim="fade", outdur=0.12)}>?</b><b class="dur-val g on" {d(in_=t_cl + 0.25, anim="up", dist=10, dur=0.26)}>48 h</b></div>
      <div class="bar-track"><div class="bar-fill gold grow" style="width:100%" {d(in_=t_cl, anim="grow", dur=0.9)}></div></div></div>''', 360, name="48h card")
snd(t, "whoosh_short", CARD_SND, pre=0.16); snd(t_skin, "pop_soft", POP_SND, pan=-0.3)      # the factual answer gets its own quiet cue
# pay-off title in the hook's grammar: the question was a big gold 48, so is the answer
t = ts(14, "en la ropa"); t_out = min(title_out(17, "me gustaría", 0.20), next_cut(t) - 0.19)
item(t - 0.05, t_out + 0.25, f'''
 <div class="center" style="left:-50px;top:1052px"><div class="titlebox">
   <div class="glow" {d(in_=t - 0.03, anim="fade", dur=0.3, out=t_out, outanim="fade", outdur=0.18)}></div>
   <div class="kw-num goldtext" {d(in_=t - 0.03, anim="scale", dur=0.42, out=t_out, outanim="down", outdur=0.18)}>48<span style="font-size:.42em;letter-spacing:0;margin-left:.08em">h</span></div><br>
   <div class="kw-lab pill" {d(in_=t + 0.12, anim="up", dist=18, dur=0.30, out=t_out, outanim="down", outdur=0.18)}><b>✓</b>&nbsp;Solo en ropa</div>
 </div></div>''', cls="kw")
snd(t - 0.85, "riser", -22.0); snd(t - 0.03, "sub_hit", -20.0, hp=38, max_peak_db=-9.0); snd(t - 0.01, "shimmer_short", -19.0)

# ===================================================================================================================== B12 — CALL TO ACTION (short)
t = ts(17, "en los comentarios") - 0.06; t_out = t + 3.7
card(t, t_out, f'''<div class="cta-row">{icon("bubble", 44)}<div class="kicker gold pk" style="margin:0">Comenten</div></div>
   <div class="cta-q">¿Lo aman<br>o los<br><i>empalaga</i>?</div>''', 280, w_max=270, name="cta")
snd(t, "whoosh_short", CARD_SND, pre=0.16)

# ===================================================================================================================== B13 — CLOSE
t = ts(19, "un perfumazo") - 0.04
item(t - 0.05, DUR, f'''
 <div class="center" style="left:-140px;top:1098px">
   <div class="plate" {d(in_=t + 0.08, anim="pop", dur=0.38)}><div class="final goldtext">Perfumazo.</div></div><br>
   <div class="pill endk" {d(in_=t + 0.36, anim="up", dist=14, dur=0.36)}>1 Million Black&nbsp;·&nbsp;Rabanne</div>
 </div>''', cls="kw")
snd(t + 0.06, "shimmer", -19.0); snd(t + 0.06, "sub_hit", -21.0, hp=38, max_peak_db=-11.0)
print("slot layout (name, in, out, width):"); [print("   ", l) for l in LAYOUT]
