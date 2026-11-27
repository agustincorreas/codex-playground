# Top 5 de BoVo Perfumes (Tahiti, Easter Island, Tulum, Santorini, Estambul) — a cámara con la caja de la colección. Tema: goldc.
HFLIP = False                           # los nombres de los frascos se leen bien
END_WORD = (36, "aroma.")
EMPH = {"tropical", "mango", "durazno", "pina", "vainilla", "unisex", "amaderado", "cremoso", "sandalo", "iris", "elegante", "sobrio", "manzana",
        "marino", "acuatico", "salado", "limpio", "almizclado", "fresco", "intenso", "oriental", "rosa", "azafran", "cuero", "maderas", "nocturno", "comentarios"}
HIDE = {}
CAPTIONS = {
 0: "yo~ no~ sé | si~ BOVO | es~ el~ nombre | que~ yo~ hubiese | elegido | para~ una~ marca | de~ perfumes | pero~ les cuento | que~ no~ tiene | que~ ver | con~ andá | pa' allá | bobo | [sino con Bon Voyage]",
 1: "esta~ es~ una | marca | que~ conocí | en~ Dubái | y~ tiene | la~ colección | [de cinco perfumes inspirados] | cada~ una | en~ una~ ciudad | o~ en~ un~ lugar | distinto | a~ donde | realmente | a~ mí~ me | gustaría | irme~ de | vacaciones",
 2: "el~ primero | que~ te~ muestro | se~ llama | [Tahiti] | y~ es | a~ lo~ que | debería | oler | una~ isla | *tropical*",
 3: "a~ frutas | jugosas | *mango* | *durazno* | *piña* | ensalada | de~ frutas | con~ almíbar | y~ *vainilla*",
 5: "el~ segundo | se~ llama | [Easter Island] | la~ famosa~ Isla | de~ Pascua | de~ Chile",
 6: "y~ esto | huele | más *amaderado* | *cremoso* | *sándalo* | *iris*",
 8: "yo lo noto | como~ una | especie | de~ mezcla~ entre | lo~ que~ puede | ser | Gris Charnel | y~ Santal | 33",
 10: "un~ buen perfume | este | un~ poquito | más *elegante* | y~ más | *sobrio*",
 12: "este perfume | se~ llama | [Tulum]",
 14: "acá también | hay~ frutas | hay algo dulce | hay unos | puntos | amaderados | cremosos",
 17: "yo~ creo | que~ esto | tiene | frutas | pero donde | predomina | la~ *manzana* | la~ *manzana* | roja | bien dulce | bien jugosa",
 18: "una~ parte | amaderada | una~ parte | floral | totalmente | *unisex*",
 20: "esto | se~ llama | [Santorini] | otro destino | espectacular | al~ que~ también | me~ gustaría | ir~ y~ no~ fui",
 25: "bueno | va | totalmente | en~ ese | estilo | de~ perfume | sin~ ser | igual",
 31: "[Estambul] | Turquía | y~ este | es~ el~ perfume | *oriental* | de~ la~ colección",
 33: "la~ *rosa* | le~ da~ el | toque | femenino | el~ *cuero* | y~ las~ *maderas* | le~ dan~ el | toque | masculino | con~ lo~ cual | queda~ totalmente | *unisex*",
}

def note_card(t, t_out, kicker, html, h=220, name="note"):
    card(t, t_out, f'<div class="kicker gold pk">{kicker}</div><div class="cta-q" style="font-size:34px;line-height:1.10">{html}</div>', h, w_max=270, name=name)
    snd(t, "whoosh_short", CARD_SND, pre=0.16)

def seq(sent, kick, items, t_out=None, alt=False):
    """Notas de una frase; de a una en el mismo lugar (o alternando arriba/abajo con alt=True cuando las dice muy seguidas). Ninguna cruza un corte."""
    ts_ = [ts(sent, w) for _, _, w in items]; step = 2 if alt else 1
    for k, (img, name, _) in enumerate(items):
        end = (ts_[k + step] - 0.14) if k + step < len(items) else (t_out or sent_span(sent)[1] + 0.25)
        end = min(end, next_cut(ts_[k]) - 0.21)
        medal(f"fragrantica/note_{img}.jpg", kick, name, ts_[k], end, (k % 2) if alt else 0, sound="pop_high" if k % 2 else "pop_soft")

def name_title(sent, word, n, name, size=".80em", until=None):
    t = ts(sent, word)
    big_title(t, min(until or (te(sent, word) + 0.55), next_cut(t) - 0.19), f'<span style="font-size:{size};white-space:nowrap">{name}</span>', f"{n} de 5", cx=540, hit=(-26.5, -28.0))
    gesture(t - 0.05, 1.08, hold=0.4, release=1.4, ax=540)

def plan():
    global POP_SND, TICK_SND, CARD_SND
    POP_SND, TICK_SND, CARD_SND = -25.0, -26.0, -25.5
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    hook_tag(ts(0, "sino") - 0.25, "Nueva marca", "¿BoVo?")
    lockup(ts(0, "sino"), ts(0, "Bon"), ts(0, "Voyage."), min(sent_span(0)[1] + 0.20, next_cut(ts(0, "Bon")) - 0.19), "BOVO", '<span style="font-size:.74em;white-space:nowrap">Bon Voyage</span>', "Perfumes&nbsp;·&nbsp;<b>Dubái</b>", cx=C)
    t = ts(1, "de", 0)
    big_title(t, min(ts(1, "cada") - 0.20, next_cut(t) - 0.19), "5", "Perfumes · 5 destinos", cx=C)
    name_title(2, "Tahiti", 1, "Tahiti")
    seq(3, "Notas", [("mango", "Mango", "mango,"), ("peach", "Durazno", "durazno,"), ("pineapple", "Piña", "piña,"), ("vanilla", "Vainilla", "vainilla.")])
    name_title(5, "Easter", 2, "Easter Island", size=".56em", until=te(5, "Island,") + 0.45)
    seq(6, "Notas", [("sandalwood", "Sándalo", "sándalo,"), ("iris", "Iris", "iris.")])
    flyby("extra/bottle_gris-charnel.png", ts(8, "Gris") - 0.05)
    flyby("extra/bottle_santal-33.png", ts(8, "Santal") - 0.05, rtl=True)
    name_title(12, "Tulum.", 3, "Tulum")
    seq(17, "Predomina", [("red-apple", "Manzana roja", "manzana,")])
    name_title(20, "Santorini,", 4, "Santorini", size=".70em")
    check_list(ts(21, "marino,") - 0.30, min(sent_span(21)[1] + 0.30, next_cut(ts(21, "salado,")) - 0.21), "Santorini", [("Marino", ts(21, "marino,")), ("Acuático", ts(21, "acuático,")), ("Salado", ts(21, "salado,"))])
    flyby("extra/bottle_black-sea.png", ts(24, "Black") - 0.05)
    name_title(31, "Estambul,", 5, "Estambul", size=".70em")
    seq(32, "Notas", [("rose", "Rosa", "rosa,"), ("saffron", "Azafrán", "azafrán,"), ("leather", "Cuero", "cuero,"), ("cedar", "Maderas", "maderas,")], alt=True)
    note_card(ts(33, "con", 0) - 0.05 if False else ts(33, "unisex.") - 0.60, sent_span(33)[1] + 0.25, "Para quién", "Totalmente<br><i>unisex</i>", h=200, name="unisex")
    cta_card(ts(36, "comentarios") - 0.06, 3.4, "Comenten", "¿Con<br>cuál te<br><i>quedás</i>?")
