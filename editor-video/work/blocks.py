# Reusable graphic blocks (exec'd inside build_project.py before the video's own plan.py; uses item(), d(), ts(), te(), sent_span(), next_cut(), asset(), ZOOM, SFX, OPT, DUR, FREEZE_AT, CUTS, E, S).
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
def zoom_sa(t):
    """(scale, anchor x) at time t — mirrors render.py's interpolation."""
    ks = sorted(ZOOM, key=lambda z: z["t"])
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
        for y, xr, xl in zip(rows, smp["right"], smp["left"]):   # measured on the source: a mirrored source is flipped on screen
            if xr < 0: continue
            ys = AY + s * (y - AY); xs = (W_ - xr) if HFLIP else xl
            if y0 - 10 <= ys <= y1 + 10: best = min(best, ax + s * (xs - ax))
        if best < 99999: vals.append(best)
    if not vals: return 380
    vals.sort(); return vals[min(len(vals) - 1, int(len(vals) * pct / 100))]
LEFT, TOP = 34, 292                    # inside Instagram's 4:5 feed crop (y >= 285) as well as the full-screen safe area
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
CARD_SND, POP_SND, TICK_SND = -24.0, -23.0, -25.0       # at least ~8 dB under the simultaneous voice
def title_out(sent, phrase, gap=0.22):
    """Titles leave just before the next caption card appears."""
    return ts(sent, phrase) - gap


# ===================================================================================================================== BLOCKS
# Every block takes absolute times on the edit timeline (use ts()/te()/sent_span() in the video's plan) and adds items + sounds.
CX = 490                                # caption/title centre (the speaker and the product usually sit right of centre)
def _dx(cx): return int(cx - 540)

def hook_tag(t_out, kicker, question):
    """Small tag with the open question, on screen from frame 0."""
    w = column(0.0, out_on_cut(t_out), TOP, TOP + 150)
    size = min(62, int((w - 48) / (0.44 * max(len(question), 1))))      # italic serif: ~0.44 em per character; never wider than the slot
    card(0.0, t_out, f'<div class="kicker gold pk" style="margin-bottom:6px;font-size:{min(25, int((w - 48) / (0.72 * max(len(kicker), 1))))}px">{kicker}</div><div class="tag-q" style="font-size:{size}px">{question}</div>', 150, instant=True, name="hook tag")

def hook_title(t_out, kicker, question, cx=CX, top=1420):
    """The hook question in the middle and in front, on screen from frame 0: a glass plate sized to its text (nothing can stick out),
    just under the caption line so both read together. This is the default way to show the hook; hook_tag is the small corner variant."""
    t_out = out_on_cut(t_out)
    item(0.0, t_out + 0.3, f"""
 <div class="center" style="left:{_dx(cx)}px;top:{top}px"><div class="glass" style="display:inline-block;padding:20px 40px 24px;text-align:center" {d(in_=0.0, anim="none", out=t_out, outanim="down", outdur=0.20)}>
   <div class="kicker gold pk" style="margin-bottom:8px">{kicker}</div><div class="tag-q" style="font-size:84px">{question}</div></div></div>""")
    LAYOUT.append(("hook title", 0.0, round(t_out, 2), 0))

def big_title(t, t_out, big, label, unit="", cx=CX, top=1052, hit=(-25.5, -27.0), riser=None, label_delay=0.10):
    """Big serif keyword (a number, a word) with a pill label under it; replaces the captions while it is up."""
    u = f'<span style="font-size:.42em;letter-spacing:0;margin-left:.08em">{unit}</span>' if unit else ""
    item(t - 0.05, t_out + 0.25, f"""
 <div class="center" style="left:{_dx(cx)}px;top:{top}px"><div class="titlebox">
   <div class="glow" {d(in_=t - 0.03, anim="fade", dur=0.3, out=t_out, outanim="fade", outdur=0.18)}></div>
   <div class="kw-num goldtext" {d(in_=t - 0.03, anim="scale", dur=0.42, out=t_out, outanim="down", outdur=0.18)}>{big}{u}</div><br>
   <div class="kw-lab pill" {d(in_=t + label_delay, anim="up", dist=18, dur=0.30, out=t_out, outanim="down", outdur=0.18)}>{label}</div>
 </div></div>""", cls="kw")
    if riser is not None: snd(t - 0.85, "riser", riser)
    snd(t - 0.03, "sub_hit", hit[0], hp=38, max_peak_db=-12.0); snd(t - 0.01, "shimmer_short", hit[1])

def lockup(t, t_script, t_pill, t_out, main, script, pill_html, cx=410, top=1056, snd_db=-24.0):
    """Product name: heavy sans line + gold italic serif line + pill (brand · launch)."""
    item(t - 0.05, t_out + 0.25, f"""
 <div class="center lockup" style="left:{_dx(cx)}px;top:{top}px">
   <div class="glow" style="width:880px;margin-left:-440px" {d(in_=t - 0.03, anim="fade", dur=0.3, out=t_out, outanim="fade", outdur=0.18)}></div>
   <div class="lk-main" style="word-spacing:0.16em" {d(in_=t - 0.03, anim="up", dist=44, dur=0.36, out=t_out, outanim="down", outdur=0.18)}>{main}</div>
   <div class="lk-script goldtext" {d(in_=t_script - 0.03, anim="up", dist=30, dur=0.36, out=t_out, outanim="down", outdur=0.18)}>{script}</div>
   <div class="lk-kick pill" {d(in_=t_pill - 0.03, anim="up", dist=14, dur=0.30, out=t_out, outanim="fade", outdur=0.16)}>{pill_html}</div>
 </div>""", cls="lk")
    snd(t - 0.05, "whoosh_soft", snd_db, pre=0.22)

def bottle_card(t, t_out, img, name, sub, snd_db=None):
    """A bottle cut-out with its name (e.g. the original of the line)."""
    card(t, t_out, f"""<div class="saga1"><img src="{asset(img)}" {d(in_=t + 0.08, anim="none", drift="0,-2,0.010")}>
   <div class="saga-name">{name}</div><div class="saga-yr">{sub}</div></div>""", 470, w_max=240, name="saga")
    snd(t, "whoosh_short", CARD_SND - 1.5 if snd_db is None else snd_db, pre=0.16)

def rating_card(t, t_out, value, votes, source="Fragrantica", snd_db=None):
    """Community rating out of 5 with stars; value like 4.3, votes like '+1.800 votos'."""
    txt = f"{value:.1f}".replace(".", ",")
    card(t, t_out, f"""
   <div class="kicker gold pk">{source}</div>
   <div class="rate"><span class="rate-num goldtext" {d(in_=t + 0.12, anim="fade", dur=0.34, count=f"{value - 0.7:.1f},{value:.1f}")}>{txt}</span><span class="rate-of">/ 5</span></div>
   {stars(value, t + 0.22)}
   <div class="rate-votes" {d(in_=t + 0.45, anim="fade", dur=0.3)}>{votes}</div>""", 300, name="rating")
    snd(t, "whoosh_short", CARD_SND - 1.5 if snd_db is None else snd_db, pre=0.16)

MED = 190; TOP_M = 240; PITCH = 306      # medallions start a little higher than the cards (pictures, not text) so two fit above his shoulder
def medal(img, kick, name, t, t_out, slot, pan=-0.3, sound="pop_soft"):
    """Round note picture with a glass label (kicker: Salida / Corazón / Fondo). slot 0 = top, 1 = under it."""
    src = asset(img)
    if not src: return
    w = column(t, t_out, TOP_M + slot * PITCH, TOP_M + slot * PITCH + 290, w_max=300)
    x = LEFT + max(0, (min(w, 270) - MED) // 2); y = TOP_M + slot * PITCH
    item(t - 0.08, t_out + 0.3, f"""<div class="abs medal" style="left:{x}px;top:{y}px" {d(in_=t - 0.05, anim="pop", dur=0.36, out=t_out, outanim="shrink", outdur=0.18)}>
        <img src="{src}" style="transform:scale(1.06)" {d(in_=t - 0.05, anim="none", drift="0,0,0.014")}></div>""", layer="back")
    item(t - 0.08, t_out + 0.3, f"""<div class="abs note-lab" style="left:{x - 44}px;top:{y + MED + 10}px;width:{MED + 88}px" {d(in_=t + 0.06, anim="up", dist=16, dur=0.3, out=t_out, outanim="fade", outdur=0.14)}>
        <div class="note-chip"><div class="kicker gold">{kick}</div><div class="note-name">{name}</div></div></div>""", layer="back")
    snd(t - 0.05, sound, POP_SND, pan=pan)

def _li(ic, txt, ti, t_card):
    return (f'<div class="li"><div class="li-dim" {d(in_=t_card + 0.18, anim="fade", dur=0.3)}>{icon(ic, 24)}<span>{txt}</span></div>'
            f'<div class="li-on" {d(in_=ti - 0.04, anim="fade", dur=0.20)}>{icon(ic, 24)}<span>{txt}</span></div></div>')
def pros_cons(t, t_out, t_cons, pros, cons, head_pro="A favor", head_con="En contra"):
    """One card, two halves; pros/cons are lists of (text, time it lights up)."""
    p = "".join(_li("check", x, ti, t) for x, ti in pros); c = "".join(_li("cross", x, ti, t) for x, ti in cons)
    card(t, t_out, f"""<div class="kicker gold pk">{head_pro}</div>{p}
   <div class="sec"><div class="kslot"><div class="kicker kick-dim" {d(in_=t + 0.18, anim="fade", dur=0.3, out=t_cons, outanim="fade", outdur=0.12)}>{head_con}</div><div class="kicker" {d(in_=t_cons, anim="fade", dur=0.2)}>{head_con}</div></div>
   {c}</div>""", 520, name="pros/cons")
    snd(t, "whoosh_short", CARD_SND, pre=0.16)
    for _, ti in pros + cons: snd(ti - 0.04, "tick", TICK_SND, pan=-0.3)

def photo_tiles(t, t_out, tiles):
    """Stacked photo tiles: list of (image, big word, small line, time)."""
    w = column(t, t_out, TOP, TOP + 360)
    tile = lambda img, big, small, ti: (f'<div class="tile" {d(in_=ti, anim="up", dist=22, dur=0.32, out=t_out, outanim="down", outdur=0.2)}><img src="{asset(img)}" {d(in_=ti, anim="none", drift="0,0,0.012")}>'
                                        f'<div class="shade"></div><div class="txt"><b>{big}</b><span>{small}</span></div></div>')
    item(t, t_out + 0.3, f'<div class="abs tiles" style="left:{LEFT}px;top:{TOP}px;width:{w}px">{"".join(tile(*x) for x in tiles)}</div>', layer="back")
    LAYOUT.append(("when", round(t, 2), round(t_out, 2), w))
    snd(t, "whoosh_short", CARD_SND, pre=0.16)

def scoreboard(t, t_out, title, rows):
    """Two-row answer card. rows = [(label, value, time it is revealed, bar %, gold?)]; values start as '?'."""
    body = ""
    for n, (lab, val, tv, pct, gold) in enumerate(rows):
        t_in = t + 0.14 + n * 0.08; late = 0.25 if gold else 0.0
        body += f"""
   <div class="dur-row" {d(in_=t_in, anim="fade", dur=0.25)}><div class="dur-head"><div class="dur-lab">{lab}</div></div>
      <div class="dur-slot"><b class="dur-val q" {d(in_=t_in + 0.06, anim="fade", dur=0.25, out=tv + (0.20 if gold else -0.02), outanim="fade", outdur=0.12)}>?</b><b class="dur-val {'g ' if gold else ''}on" {d(in_=tv + late, anim="up", dist=10, dur=0.26)}>{val}</b></div>
      <div class="bar-track"><div class="bar-fill {'gold ' if gold else ''}grow" style="width:{pct}%" {d(in_=tv, anim="grow", dur=0.9 if gold else 0.6)}></div></div></div>"""
    card(t, t_out, f"""
   <div class="kicker gold pk">{title}</div>{body}""", 360, name="48h card")
    snd(t, "whoosh_short", CARD_SND, pre=0.16); snd(rows[0][2], "pop_soft", POP_SND, pan=-0.3)

def cta_card(t, dur, kicker, lines_html):
    """Comment prompt; lines_html uses <br> and <i> for the accent word."""
    t_out = t + dur
    w_cta = column(t, out_on_cut(t_out), TOP, TOP + 280, w_max=270)
    card(t, t_out, f"""<div class="cta-row">{icon("bubble", 40)}<div class="kicker gold pk" style="margin:0">{kicker}</div></div>
   <div class="cta-q" style="font-size:{44 if w_cta >= 240 else 37}px">{lines_html}</div>""", 280, w_max=270, name="cta")
    snd(t, "whoosh_short", CARD_SND, pre=0.16)

def end_plate(t, t_word_end, word, pill_html, cx=400, top=1098):
    """Closing verdict plate held over the frozen last frame; its sound waits for the end of the last word."""
    item(t - 0.05, DUR, f"""
 <div class="center" style="left:{_dx(cx)}px;top:{top}px">
   <div class="plate" {d(in_=t + 0.08, anim="pop", dur=0.38)}><div class="final goldtext">{word}</div></div><br>
   <div class="pill endk" {d(in_=t + 0.36, anim="up", dist=14, dur=0.36)}>{pill_html}</div>
 </div>""", cls="kw")
    snd(t_word_end + 0.04, "shimmer_low", -21.0)

def check_list(t, t_out, title, items):
    """One glass card with a title and ticked lines that light up as he says them. items = [(text, time)]."""
    card(t, t_out, f'<div class="kicker gold pk">{title}</div>' + "".join(_li("check", x, ti, t) for x, ti in items), 120 + 62 * len(items), name="list")
    snd(t, "whoosh_short", CARD_SND, pre=0.16)
    for _, ti in items: snd(ti - 0.04, "tick", TICK_SND, pan=-0.3)

def flyby(img, t, y=330, h=520, dur=0.85, rtl=False, opacity=0.92):
    """A bottle cut-out (no background) that crosses the frame quickly BEHIND the speaker when he names another perfume.
    Brief on purpose: it is a visual reference, not a product placement."""
    src = asset(img)
    if not src: return
    x0 = W_ + 40 if rtl else -h; v = (-(W_ + h + 80) if rtl else (W_ + h + 80)) / dur
    item(t - 0.02, t + dur + 0.05, f"""<img class="abs" src="{src}" style="left:{x0}px;top:{y}px;height:{h}px;width:auto;opacity:{opacity};filter:drop-shadow(0 14px 22px rgba(0,0,0,.35))" {d(in_=t, anim="none", drift=f"{v:.0f},0,0", out=t + dur, outanim="cut")}>""", layer="back")
    snd(t, "whoosh_short", CARD_SND - 3.0, pre=0.10, pan=0.3 if rtl else -0.3)

def brand_badge(t, t_out, name, logo=None, kicker="Marca"):
    """The brand on screen when he names it: its logo if we have the file, otherwise the name set as a wordmark."""
    src = asset(logo) if logo else None
    inner = f'<img src="{src}" style="display:block;width:100%;height:auto;opacity:1 !important">' if src else f'<div class="brand-word" style="font-size:{min(38, int(196 / (0.80 * max(len(l) for l in name.split("<br>")))))}px;line-height:1.25">{name}</div>'
    card(t, t_out, f'<div class="kicker gold pk">{kicker}</div>{inner}', 150, w_max=240, name="brand")
    snd(t, "whoosh_short", CARD_SND - 2.5, pre=0.16)

def web_shot(t, t_out, img, url, cx=CX, top=1190, w=310, sub=None):
    """A screenshot of the brand's site (or profile) in FRONT, where he points when he says "les dejo los datos": a bar with the address on top (it survives the 4:5 feed crop)
    and the picture under it; the bar carries the address (and an optional second line, e.g. the Instagram handle). Keep it inside the 4:5 feed crop (bottom <= ~1640)."""
    src = asset(img)
    if not src: return
    t_out = out_on_cut(t_out)
    line2 = f'<div style="font:600 21px/1.2 var(--sans);color:var(--gold);margin-top:3px">{sub}</div>' if sub else ""
    item(t - 0.05, t_out + 0.3, f"""
 <div class="abs glass" style="left:{int(cx - w / 2)}px;top:{top}px;width:{w}px;overflow:hidden" {d(in_=t, anim="up", dur=0.36, dist=30, out=t_out, outanim="down", outdur=0.20)}>
   <div style="padding:12px 8px 14px;text-align:center"><div style="font:700 {min(25, int((w - 20) / (0.60 * len(url))))}px/1.15 var(--sans);color:var(--white);white-space:nowrap">{url}</div>{line2}</div>
   <img src="{src}" style="display:block;width:100%;height:auto"></div>""")
    LAYOUT.append(("web", round(t, 2), round(t_out, 2), w))
    snd(t, "whoosh_short", CARD_SND, pre=0.16)
