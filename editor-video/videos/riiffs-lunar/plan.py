# Nuevos Lunar Pulse y Lunar Blush (Riiffs) — primer acercamiento, de pie en un pasillo, remera azul gris. Tema: violet.
HFLIP = False                           # lo filma otra persona con la cámara trasera
END_WORD = (31, "primero.")
EMPH = {"primicia", "locura", "frutal", "fresco", "veraniego", "tropical", "unisex", "pina", "bergamota", "limon", "extracto", "original",
        "femenino", "fucsia", "cafe", "floral", "dulce", "intenso", "tremendos", "comentarios"}
HIDE = {}
CAPTIONS = {
 1: "esto~ es~ una | *primicia* | mundial",
 2: "miren | estos~ dos | perfumes | [Lunar Blush y Lunar Pulse de Riiffs] | son los dos | lanzamientos | que~ la~ marca | está | presentando | ahora mismo | en~ New York",
 4: "[vamos primero con Lunar Pulse]",
 5: "miren~ lo~ que~ es | la~ presentación | sola",
 6: "o~ sea | yo~ ya~ me~ lo | compraría | solo | por~ esta | presentación | que~ es~ una | *locura* | total",
 7: "pero~ no~ es | solo eso | porque | también | miren~ lo~ que~ es | la~ tapa",
 9: "esto | esto~ es | híper | *frutal* | no~ sé~ si~ ahí | hay algo | de~ *piña* | algo cítrico | seguro~ que~ hay | *bergamota* | *limón*",
 10: "apenitas | *dulce* | no~ es~ un | perfume | que~ lo | categorizaría | como *dulce* | pero sí *frutal* | *fresco* | *veraniego* | *tropical* | sobre todo | para~ el~ verano | que~ se~ viene | acá~ en~ Sudamérica",
 11: "no~ tiene | género | para~ mí | es~ totalmente | *unisex* | pero | yo~ lo~ usaría | completamente | este perfume | sobre~ todo | ahora | primavera | verano",
 13: "muy~ muy~ *frutal* | y~ lo~ que | me~ gusta | es~ bueno | primero | es~ *extracto* | de~ perfume | y~ lo~ otro | que~ me~ gusta | es~ que | hasta donde | sé | y~ por~ lo~ menos | lo~ que~ puedo | detectar | no~ es~ dupe | de~ nada | no~ se~ parece | a~ nada | es~ una~ creación | totalmente | [original de la marca] | y~ eso | siempre | lo~ celebramos",
 14: "[y ahora vamos con Lunar Blush] | que~ por~ la | presentación | adivino | que~ puede | ir más | hacia | el~ lado | *femenino*",
 15: "mismo frasco | pero~ con~ un | tono | más *fucsia* | también | esta tapa | impresionante",
 16: "y~ este | me~ lo~ voy | a~ atomizar | acá",
 20: "bastante | fuerte | más tirando | a~ lo~ *dulce* | yo diría | que~ es~ un | perfume",
 21: "*frutal* | *floral* | con~ ese | punto | de~ *café*",
 23: "*femenino* | sí~ es~ verdad | un~ poquito | más inclinado | a~ lo~ *femenino* | *dulce* | *intenso*",
 26: "*tremendos* | estos~ dos | lanzamientos | de~ Riiffs",
 27: "son perfumes | que~ recién | ahora | están saliendo | al~ mercado",
 30: "Lunar | Pulse | y~ Lunar Blush | de~ Riiffs",
}

def note_card(t, t_out, kicker, html, h=220, name="note"):
    card(t, t_out, f'<div class="kicker gold pk">{kicker}</div><div class="cta-q" style="font-size:34px;line-height:1.10">{html}</div>', h, w_max=270, name=name)
    snd(t, "whoosh_short", CARD_SND, pre=0.16)

def seq(sent, kick, items, t_out=None):
    t_out = out_on_cut(t_out or sent_span(sent)[1] + 0.25)
    ts_ = [ts(sent, w) for _, _, w in items]
    for k, (img, name, _) in enumerate(items):
        medal(f"fragrantica/note_{img}.jpg", kick, name, ts_[k], (ts_[k + 1] - 0.14) if k + 1 < len(items) else t_out, 0, sound="pop_high" if k % 2 else "pop_soft")

def plan():
    global POP_SND, TICK_SND, CARD_SND
    POP_SND, TICK_SND, CARD_SND = -25.0, -26.0, -25.5
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    gesture(ts(1, "primicia") - 0.05, 1.09, until_cut=True, ax=C)
    gesture(ts(8, "locura") - 0.05, 1.08, until_cut=True, ax=C)
    gesture(ts(26, "Tremendos") - 0.05, 1.07, hold=0.5, release=1.6, ax=C)
    hook_tag(ts(2, "Miren,") - 0.25, "Primicia", "¿Qué lanzó<br>Riiffs?")
    t = ts(2, "Lunar")
    lockup(t, ts(2, "Blush"), ts(2, "de"), min(ts(2, "son") - 0.20, next_cut(ts(2, "de")) - 0.19), "LUNAR", '<span style="font-size:.74em;white-space:nowrap">Blush &amp; Pulse</span>', "Riiffs&nbsp;·&nbsp;<b>Lanzamiento</b>", cx=C)
    # Lunar Pulse
    t = ts(4, "Vamos")
    big_title(t, min(sent_span(4)[1] + 0.15, next_cut(ts(4, "Lunar")) - 0.19), '<span style="font-size:.80em">Pulse</span>', "1 · Lunar Pulse", cx=C, hit=(-26.5, -28.0))
    seq(9, "Quizás", [("pineapple", "Piña", "piña,"), ("bergamot", "Bergamota", "bergamota,"), ("lemon", "Limón", "limón,")])
    check_list(ts(10, "frutal,") - 0.30, te(10, "tropical,") + 0.9, "Lunar Pulse", [("Frutal", ts(10, "frutal,")), ("Fresco", ts(10, "fresco,")), ("Veraniego", ts(10, "veraniego,")), ("Tropical", ts(10, "tropical,"))])
    check_list(ts(11, "unisex,") - 0.30, sent_span(11)[1] + 0.25, "Para quién", [("Unisex", ts(11, "unisex,")), ("Primavera", ts(11, "primavera,")), ("Verano", ts(11, "verano,"))])
    note_card(ts(13, "extracto") - 0.05, ts(13, "y", 1) + 1.2, "Versión", "Extracto<br>de <i>perfume</i>", h=200, name="extracto")
    t = ts(13, "original")
    big_title(t, min(sent_span(13)[1] + 0.10, next_cut(t) - 0.19), '<span style="font-size:.72em">Original</span>', "No es dupe de nada", cx=C, hit=(-27.0, -26.0))
    # Lunar Blush
    t = ts(14, "Y")
    big_title(t, min(ts(14, "que") - 0.20, next_cut(ts(14, "Blush,")) - 0.19), '<span style="font-size:.80em">Blush</span>', "2 · Lunar Blush", cx=C, hit=(-26.5, -28.0))
    seq(19, "Salida", [("coffee", "Café", "café")])
    check_list(ts(21, "frutal,") - 0.30, sent_span(21)[1] + 0.30, "Lunar Blush", [("Frutal", ts(21, "frutal,")), ("Floral", ts(21, "floral,")), ("Café", ts(21, "café,"))])
    note_card(ts(23, "femenino") - 0.05, min(te(23, "intenso") + 0.30, next_cut(te(23, "intenso") - 0.05) - 0.21), "Perfil", "Más <i>femenino</i>,<br>dulce e intenso", h=210, name="perfil")
    brand_badge(ts(26, "Riiffs.") - 0.25, sent_span(27)[1] + 0.20, "Riiffs")
    CARD_SND = -27.5
    cta_card(ts(31, "comentarios") - 0.06, 3.2, "Comenten", "¿Pulse<br>o <i>Blush</i>?")
