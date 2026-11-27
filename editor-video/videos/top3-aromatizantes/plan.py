# Top 3 aromatizantes para el hogar (Nardo & Partners) — plano medio, frascos en la mesa. Tema: nardo.
# Dice "Herbal Essence" pero la etiqueta dice "Herbal Silence": en pantalla va el nombre de la etiqueta y esas palabras no llevan subtítulo.
HFLIP = False
END_WORD = (25, "conseguirlos")
EMPH = {"monasterio", "budista", "espectacular", "energizante", "limpio", "autodescriptivo", "sabanas", "locura", "bidoncito"}
HIDE = {0: "Top 3 mejores aromatizantes para el hogar", 1: "Puesto número 3 para Herbal Essence", 4: "Puesto número 2 para el número 4", 13: "en el puesto número 1", 20: "20 litros"}
AUDIO = {"end_fade_ms": 60}            # el crudo sigue con "Gracias" pegado: el final corta en el silencio previo, con un fundido corto
CAPTIONS = {
 2: "esto huele | [a] | un~ *monasterio* | *budista* | de~ hierbas | y~ sándalo",
 0: "[top 3 mejores aromatizantes para el hogar] | y~ para | que~ tu~ casa | no~ huela | todo el día | a~ bife | con~ papas | fritas",
 1: "[puesto número 3 para Herbal Essence] | de~ la~ línea | Wellness | de~ Nardo | &~ Partners",
 4: "[puesto número 2 para el número 4] | también | de~ Nardo | &~ Partners",
 10: "esto | como lo dice | el~ nombre | huele | a~ flores | y~ frutas | frescas | y~ acuáticas | bastante | *energizante* | y~ *limpio*",
 13: "[y en el puesto número 1] | y~ tengo | entendido | que~ también | es~ el~ más | vendido | de~ la~ marca | [el] | número | 1 | que~ es~ el | Cítrico | Chispeante",
 14: "y~ bueno | esto es | muy | *autodescriptivo*",
 15: "literalmente | huele | a~ cítricos | chispeantes | limpios | un~ poquito | de~ ropa | limpia",
 16: "es~ como~ si | tus | *sábanas* | limpias | les hubieses | puesto | una~ esencia | de~ limón",
 18: "es~ una~ cosa | que~ quiero | estar | que~ toda | mi~ casa | esté~ oliendo | a~ esto | absolutamente | todo el día",
 20: "necesito | [20 litros] | un~ *bidoncito* | de~ 20 | litros | Sole | por~ favor | de~ Cítrico | Chispeante",
 21: "y~ además | tiene toda | su~ línea | de~ difusores | también | para el hogar",
}
T_TOP = 930                             # los títulos van sobre la remera negra, arriba de los frascos

def rank(sent, phrase, n, label, t_out):
    t = ts(sent, phrase)
    big_title(t, min(t_out, next_cut(t) - 0.19), n, label, cx=540, top=T_TOP, hit=(-26.5, -28.0))

def plan():
    global AY, POP_SND
    AY = 420; POP_SND = -24.5
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    gesture(ts(2, "monasterio") - 0.05, 1.09, hold=0.6, release=1.8, ax=C)
    gesture(ts(13, "Cítrico Chispeante") - 0.05, 1.09, hold=0.6, release=1.8, ax=C)
    gesture(ts(16, "sábanas") - 0.05, 1.08, hold=0.5, release=1.8, ax=C)
    gesture(ts(19, "locura") - 0.05, 1.08, until_cut=True, ax=C)
    zkey(ts(25, "para que"), 1.0, "cut"); zkey(DUR, 1.05, "inout")
    # gancho
    big_title(ts(0, "Top"), title_out(0, "y para"), '<span style="font-size:.62em">Top&nbsp;3</span>', "Aromatizantes para el hogar", cx=C, top=T_TOP)
    # puesto 3
    rank(1, "Puesto", "3", "Wellness&nbsp;·&nbsp;<b>Herbal Silence</b>", title_out(1, "de la línea"))
    brand_badge(ts(1, "de la línea") - 0.05, sent_span(1)[1] + 0.20, "Nardo &amp;<br>Partners", logo="web/nardo_logo.png")
    t_h, t_s = ts(2, "hierbas"), ts(2, "sándalo")
    medal("fragrantica/note_rosemary.jpg", "Puesto 3", "Hierbas", t_h, t_s - 0.14, 0)
    medal("fragrantica/note_sandalwood.jpg", "Puesto 3", "Sándalo", t_s, out_on_cut(sent_span(3)[1] + 0.15), 0, sound="pop_high")
    # puesto 2
    rank(4, "Puesto", "2", "N°4&nbsp;·&nbsp;<b>Floral Frutal Suave</b>", title_out(4, "también"))
    medal("fragrantica/note_peony.jpg", "Puesto 2", "Flores", ts(10, "flores"), out_on_cut(sent_span(10)[1] + 0.15), 0)
    medal("fragrantica/note_peach.jpg", "Puesto 2", "Frutas", ts(10, "frutas"), out_on_cut(sent_span(10)[1] + 0.15), 1, sound="pop_high")
    # puesto 1
    rank(13, "puesto", "1", "N°1&nbsp;·&nbsp;<b>Cítrico Chispeante</b>", title_out(13, "y tengo"))
    medal("fragrantica/note_orange.jpg", "Puesto 1", "Cítricos", ts(15, "cítricos"), out_on_cut(sent_span(15)[1] + 0.15), 0)
    medal("fragrantica/note_lemon.jpg", "Puesto 1", "Limón", ts(16, "limón"), out_on_cut(sent_span(17)[1] + 0.15), 0, sound="pop_high")
    t = ts(20, "20 litros")
    big_title(t, min(title_out(20, "un bidoncito", 0.20), next_cut(t) - 0.19), "20", "Cítrico Chispeante", unit="L", cx=C, top=T_TOP, hit=(-26.5, -28.0), riser=-27.5)
    # dónde conseguirlos: la captura de la tienda, adelante, donde señala con el dedo
    web_shot(ts(25, "Les") - 0.02, DUR - 0.22, "web/nardo_web.jpg", "nardoandpartners.com", cx=400, w=350, sub="@nardoandpartners")
