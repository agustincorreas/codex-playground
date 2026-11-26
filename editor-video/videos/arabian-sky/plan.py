# Arabian Sky (Armaf) — reseña a cámara, frasco turquesa. Tema: sky.
HFLIP = False                           # la toma no está espejada
END_WORD = (30, "comentarios")
EMPH = {"perfumazo", "fresco", "citrico", "lavanda", "invictus", "hawas", "espectacular", "cumplidos", "locura", "intenso"}
HIDE = {1: "Arabian Sky de Armaf, esta reseña se presenta sola", 8: "5 o 6 metros", 18: "10 de 10"}
CAPTIONS = {
 12: "este~ es~ un *perfumazo* | gente",
 19: "no puedo | hacer más | que recomendárselos",
 23: "de los mejores | perfumes | que tiene Armaf | y~ de~ los mejores | perfumes árabes | que~ tengo~ en~ mi | colección",
 26: "úsenlo cuando | tengan ganas | porque~ es~ un *perfumazo*",
 24: "*fresco* | para uso diario | versátil | para jóvenes | para~ grandes | para viejos | para~ lo~ que quieran | para~ lo~ que quieran",
}

def plan():
    global POP_SND
    POP_SND = -24.5                     # los pops caen sobre palabras dichas bajito
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    gesture(ts(8, "5 o 6 metros") - 0.05, 1.10, hold=0.8, release=2.0, ax=C)
    gesture(ts(12, "perfumazo") - 0.05, 1.08, until_cut=True, ax=C)
    gesture(ts(18, "10 de 10") - 0.05, 1.11, hold=0.8, release=2.0, ax=C)
    gesture(ts(27, "se la banca") - 0.05, 1.07, hold=0.5, release=1.8, ax=C)
    zkey(ts(30, "en los comentarios"), 1.0, "cut"); zkey(DUR, 1.05, "inout")
    # nombre del producto desde el primer cuadro
    lockup(ts(1, "Arabian"), ts(1, "Sky"), ts(1, "de Armaf"), title_out(1, "porque"), "ARABIAN", "Sky", "Armaf&nbsp;·&nbsp;<b>Eau de Parfum</b>", cx=C)
    # la anécdota: cuánto proyecta
    big_title(ts(8, "5 o 6 metros"), title_out(8, "de distancia"), "6", "Se siente a distancia", unit="m", cx=C, hit=(-26.5, -28.0))
    # duración
    scoreboard(ts(11, "Fragrantica") - 0.05, sent_span(11)[1] + 0.45, "Duración",
               [("Dicen", "7 h", ts(11, "7 horas") - 0.04, 55, False), ("En piel", "+7 h", ts(11, "más de 7") - 0.04, 100, True)])
    # a qué huele
    t_ci, t_ma = ts(13, "cítrico"), ts(13, "amaderado")
    medal("fragrantica/note_blood-orange.png", "Salida", "Cítricos", t_ci, t_ma - 0.14, 0)
    medal("extra/note_lavender.jpg", "Corazón", "Lavanda", ts(13, "lavanda"), t_ma - 0.14, 1, sound="pop_high")
    medal("fragrantica/note_ebony-wood.png", "Fondo", "Maderas", t_ma, sent_span(13)[1] + 0.30, 0, sound="pop_high")
    # los perfumes que nombra pasan un instante por detrás, sin fondo
    flyby("extra/bottle_invictus.png", ts(14, "Invictus") - 0.05)
    flyby("extra/bottle_hawas.png", ts(16, "Hawas") - 0.05, rtl=True)
    # veredicto
    t = ts(18, "10 de 10")
    big_title(t, min(title_out(19, "no puedo", 0.20), next_cut(t) - 0.19), "10", "Arabian Sky", unit="/10", cx=C, hit=(-27.0, -26.0), riser=-27.5)
    cta_card(ts(20, "dejen") - 0.06, 3.6, "Comenten", "¿Dónde<br>se<br><i>consigue</i>?")
    check_list(ts(27, "dura") - 0.05, sent_span(27)[1] + 0.30, "Por qué sí",
               [("Dura", ts(27, "dura")), ("Rinde", ts(27, "rinde")), ("Proyecta", ts(27, "proyecta")), ("Gusta", ts(27, "le gusta")), ("Cumplidos", ts(27, "cumplidos"))])
    brand_badge(ts(23, "que tiene Armaf") - 0.05, sent_span(23)[1] + 0.20, "Armaf")
