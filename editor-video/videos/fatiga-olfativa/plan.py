# Fatiga olfativa + Jazmín Sublime (Aromanza) — charla a cámara, plano corto, ropa clara. Tema: jazmin.
HFLIP = False                           # la etiqueta se lee derecha
END_WORD = (33, "casa")
EMPH = {"falsificacion", "adulterado", "olfato", "acostumbra", "difusores", "jazmines", "infancia", "espectacular", "realista", "locura", "enamorado", "fundamental"}
HIDE = {2: "fatiga olfativa", 17: "Jazmín Sublime", 29: "5 litros"}
CAPTIONS = {
 0: "este perfume | me duró | *5~ minutos* | ya~ no~ me~ lo | siento | más | es~ una | *falsificación* | está | *adulterado*",
 2: "y~ creo | que~ en~ algunos | casos | no~ están | teniendo | en~ cuenta | un~ factor | importantísimo | [que es la fatiga olfativa]",
 3: "que~ no~ es | nada~ más | ni~ nada | menos que | cuando | nuestro *olfato* | se~ *acostumbra* | a~ ciertos | aromas | que~ percibe | como~ cotidianos | familiares | e~ inofensivos",
 4: "para explicarlo | no~ hay~ un | mejor ejemplo | que~ el~ olor | de~ tu~ casa",
 10: "yo por ejemplo | en~ mi~ caso | siempre | tengo la casa | repleta | de~ *difusores* | uso | home sprays | los~ aplico | en~ las~ cortinas | los~ almohadones | del~ sillón",
 20: "si~ les gusta | el~ olor | a~ esta | imagen | que~ les muestro | acá | que~ son | *jazmines* | que~ son | de~ esta época | de~ noviembre | de~ la~ primavera",
 22: "porque mi mamá | hasta el día | de~ hoy | sigue | llenando | la~ casa | de~ estos | *jazmines*",
 26: "nunca | en~ mi~ vida | había sentido | el~ olor | de~ los~ *jazmines* | en~ noviembre | frescos | verdes | como recién | cortados | del~ tallo | de~ manera | tan~ *realista* | como acá",
 27: "no~ sé | qué magia | oculta | tiene | esto adentro | pero~ es~ una | *locura* | lo~ rico | que~ es~ este | home spray",
 32: "bueno | a~ todos | los~ que~ les | guste | que~ su~ casa | huela bien | y~ no~ le | queden | olores | feos | a~ comida | a~ cigarrillo | a~ lo~ que~ sea | *fundamental* | perfumar | la~ casa",
 33: "y~ díganme | ustedes | con~ qué | sacan | los~ olores | de~ su~ casa",
}

def plan():
    global AY, POP_SND
    AY = 470                            # plano corto: los ojos están más arriba que en las reseñas
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    gesture(ts(2, "fatiga olfativa") - 0.05, 1.10, hold=0.9, release=2.0, ax=C)
    gesture(ts(6, "qué olor") - 0.05, 1.08, until_cut=True, ax=C)
    gesture(ts(26, "tan realista") - 0.05, 1.08, hold=0.5, release=1.8, ax=C)
    gesture(ts(28, "enamorado") - 0.05, 1.09, hold=0.6, release=1.8, ax=C)
    zkey(ts(33, "con qué"), 1.0, "cut"); zkey(DUR, 1.05, "inout")
    # gancho: la queja de siempre, desde el primer cuadro
    hook_title(ts(2, "fatiga olfativa") - 0.30, "¿Tu perfume", "no dura?", cx=C)
    big_title(ts(2, "fatiga olfativa"), title_out(3, "que no es"), '<span style="font-size:.60em">Fatiga</span>', "Olfativa", cx=C, top=1080, hit=(-28.0, -29.5))
    check_list(ts(3, "nuestro olfato") - 0.05, sent_span(3)[1] + 0.30, "Ya no sentís",
               [("Cotidianos", ts(3, "cotidianos")), ("Familiares", ts(3, "familiares")), ("Inofensivos", ts(3, "inofensivos"))])
    # cómo perfuma la casa
    check_list(ts(10, "repleta") - 0.05, sent_span(10)[1] + 0.25, "En mi casa",
               [("Difusores", ts(10, "difusores")), ("Home sprays", ts(10, "home sprays")), ("Cortinas", ts(10, "cortinas")), ("Sillón", ts(10, "almohadones"))])
    brand_badge(ts(16, "Aromanza") - 0.05, out_on_cut(sent_span(16)[1] + 0.20), "Aromanza")
    # el producto
    lockup(ts(17, "Jazmín"), ts(17, "Sublime"), ts(17, "Sublime") + 0.25, min(title_out(20, "Si les"), next_cut(ts(17, "Sublime")) - 0.19), "JAZMÍN", "Sublime", "Aromanza&nbsp;·&nbsp;<b>Home spray</b>", cx=C, snd_db=-27.0)
    # "esta imagen que les muestro acá"
    medal("fragrantica/note_gardenia.jpg", "Noviembre", "Jazmines", ts(20, "imagen") - 0.05, out_on_cut(sent_span(20)[1] + 0.20), 0)
    check_list(ts(26, "frescos") - 0.05, sent_span(26)[1] + 0.25, "Huele a", [("Fresco", ts(26, "frescos")), ("Verde", ts(26, "verdes")), ("Recién cortado", ts(26, "recién"))])
    t = ts(29, "5 litros")
    big_title(t, min(title_out(29, "de Jazmín", 0.20), next_cut(t) - 0.19), "5", "Jazmín Sublime", unit="L", cx=C, top=1080, hit=(-26.5, -28.0))
    cta_card(ts(33, "díganme") - 0.06, 3.0, "Comenten", "¿Con qué<br>sacan los<br><i>olores</i>?")
