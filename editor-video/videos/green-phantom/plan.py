# Green Phantom (Bharara) — reseña a cámara, frasco verde, camisa blanca. Tema: green (esmeralda, subtítulos centrados).
HFLIP = False                           # la toma no está espejada (el micrófono y la etiqueta se leen bien)
END_WORD = (30, "aromas.")
EMPH = {"viral", "perfumazo", "carisimo", "floral", "citrico", "amaderado", "rosa", "verde", "herbal", "vetiver", "musgo", "pachuli", "roble",
        "femenino", "masculino", "unisex", "espectacular", "moderada", "cercania", "cena", "cita", "sutil", "secreto", "comentarios"}
HIDE = {}
CAPTIONS = {
 1: "estoy hablando | [de Green Phantom de Bharara]",
 2: "este~ es~ un | perfume | que~ sacaron | este año | y~ rompieron | todo",
 4: "Bharara | tiró | la~ casa | por~ la~ ventana | con~ este perfume | en~ mi~ opinión",
 5: "se~ mandaron | una~ obra | maestra | un~ *perfumazo*",
 10: "para empezar | te~ lo~ voy | a~ describir | [en tres simples palabras] | para~ que | entiendas | a~ qué~ huele | este perfume",
 11: "este~ es~ un | perfume | *floral* | *cítrico* | y~ *amaderado*",
 13: "ahora | si~ querés | hacer | doble clic | en~ los~ matices | lo~ *floral* | viene | por~ el~ lado | de~ la~ *rosa* | lo~ *cítrico* | se~ va | hacia | algo | también | *verde* | y~ un~ puntito | *herbal*",
 16: "este~ es~ un | perfume | que~ a~ algunos | hombres | les~ puede | resultar | un~ poquito | *femenino* | y~ a~ algunas | mujeres | les~ puede | resultar | un~ poquito | *masculino*",
 18: "para~ mí | es~ totalmente | genderless | *unisex* | como lo quieran | llamar",
 22: "es~ de~ verdad | una~ obra | maestra | para~ mí | de~ lo~ mejor | que~ ha hecho | Bharara | en~ el~ último | tiempo | junto | con~ el~ Rey | de~ Reyes",
 23: "duración | *espectacular* | a~ mí | 8 horas | 7-8 | horas | por~ lo~ menos | me~ dura | este perfume",
 24: "se~ siente | obvio | que~ es~ una | proyección | *moderada* | más~ de~ *cercanía*",
 25: "yo~ lo | recomendaría | mucho | para una *cena* | para una *cita*",
 27: "ojo | tengan | ese~ tip | anotado | un~ perfume | *sutil* | que~ se~ sienta | en~ *cercanía* | como este | recontra | va",
 28: "y~ aparte | otro | *secreto* | que~ las~ las | mujeres | les~ gustan | mucho | los~ perfumes | que~ huelen | un~ poquito | femeninos",
 29: "ténganlo | en~ cuenta | para | los~ machos | alfa",
}

def note_card(t, t_out, kicker, html, h=240, name="note"):
    card(t, t_out, f'<div class="kicker gold pk">{kicker}</div><div class="cta-q" style="font-size:30px;line-height:1.12">{html}</div>', h, w_max=270, name=name)
    snd(t, "whoosh_short", CARD_SND, pre=0.16)

def seq(sent, kick, items, t_out=None):
    """Notas de una frase, de a una en el mismo lugar. items = [(imagen, nombre, palabra)]."""
    t_out = t_out or sent_span(sent)[1] + 0.25
    ts_ = [ts(sent, w) for _, _, w in items]
    for k, (img, name, _) in enumerate(items):
        medal(f"fragrantica/note_{img}.jpg", kick, name, ts_[k], (ts_[k + 1] - 0.14) if k + 1 < len(items) else t_out, 0, sound="pop_high" if k % 2 else "pop_soft")

def plan():
    global POP_SND, TICK_SND, CARD_SND
    POP_SND, TICK_SND, CARD_SND = -25.0, -26.0, -25.5
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    gesture(ts(5, "obra") - 0.05, 1.09, until_cut=True, ax=C)
    gesture(ts(22, "obra") - 0.05, 1.08, hold=0.6, release=1.8, ax=C)
    gesture(ts(29, "machos") - 0.05, 1.08, until_cut=True, ax=C)
    # gancho + producto
    hook_title(te(0, "video.") + 0.20, "No lo compres<br><i>sin ver esto</i>", top=880)
    lockup(ts(1, "de"), ts(1, "Phantom"), ts(1, "de", 1), min(sent_span(1)[1] + 0.15, next_cut(ts(1, "Green")) - 0.19), "GREEN", "Phantom", "Bharara&nbsp;·&nbsp;<b>Lanzamiento 2026</b>", cx=C)
    # a qué huele
    t = ts(10, "tres")
    big_title(t, min(ts(10, "para", 1) - 0.20, next_cut(t) - 0.19), "3", "Palabras", cx=C, hit=(-26.5, -28.0))
    check_list(ts(11, "Este") - 0.05, sent_span(11)[1] + 0.30, "A qué huele", [("Floral", ts(11, "floral,")), ("Cítrico", ts(11, "cítrico")), ("Amaderado", ts(11, "amaderado."))])
    seq(13, "Matices", [("rose", "Rosa", "rosa,"), ("green", "Verde", "verde"), ("rosemary", "Herbal", "herbal,")])
    seq(14, "Maderas", [("vetiver", "Vetiver", "vetiver,"), ("oakmoss", "Musgo", "musgo,"), ("patchouli", "Pachulí", "pachulí,"), ("oak", "Roble", "roble.")])
    # para quién
    check_list(ts(16, "a", 0) - 0.05, sent_span(18)[1] + 0.25, "Para quién", [("Hombres", ts(16, "hombres")), ("Mujeres", ts(16, "mujeres")), ("Unisex", ts(18, "unisex,"))])
    # rendimiento
    scoreboard(ts(23, "Duración") - 0.05, sent_span(23)[1] + 0.25, "Duración", [("En mi piel", "7–8 h", ts(23, "8") - 0.04, 90, True)])
    check_list(ts(25, "Yo") - 0.05, sent_span(25)[1] + 0.30, "Ideal para", [("Una cena", ts(25, "cena,")), ("Una cita", ts(25, "cita,"))])
    note_card(ts(27, "tip") - 0.05, sent_span(27)[1] + 0.25, "Tip", "Sutil y<br>de cerca:<br><i>recontra va</i>", h=240, name="tip")
    cta_card(ts(30, "comentarios") - 0.06, 3.2, "Comenten", "¿Ya lo<br><i>probaste</i>?")
