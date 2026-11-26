# 1 Million Black (Rabanne) — reseña a cámara. Todo lo propio de este video: guion de subtítulos, sonido puntual y plan de gráficos.
# Lo ejecuta work/build_project.py:  build_project.py <edl.json> <proyecto> --video videos/1million-black
END_WORD = (19, "perfumazo")            # última palabra: ahí se congela la imagen bajo la placa de cierre
AUDIO = {
    # tres remates dichos más bajo (segundos del crudo, dB)
    "post_gain": [[17.55, 19.62, 2.0], [115.4, 120.15, 1.7], [136.4, 139.25, 2.0]],
    # murmullo entre "como dije," y "pero un perfumazo" (segundos del crudo, dB, rampa)
    "duck_extra": [[137.79, 138.06, -10.0, 0.05]],
}
# Una línea por frase. "|" separa tarjetas. *palabra* = acento. [palabras] = dichas pero sin subtítulo (las muestra un título).
# "a~ b" = b aparece junto con a;  "~a b" = a espera a b.  Las frases que no figuren acá se agrupan solas.
CAPTIONS = {
 0: "la marca | promete | que~ este perfume | dura | [48 horas] | y al final | del video | te~ voy~ a~ decir | si~ eso | es *verdad* | o no",
 1: "esto~ es | [One Million Black de Rabanne el último lanzamiento] | ~de ~la mítica | y famosísima | línea | One~ Million | de perfumes",
 2: "si~ no usaste | One~ Million | alguna~ vez | en tu vida | es porque | nunca~ fuiste | a~ un *boliche*",
 3: "lo cierto | es~ que | según | Fragrantica | [a 8 de cada 10 personas] | les *encanta* | este perfume",
 4: "me parece | uno~ de~ los | *mejores* | lanzamientos | del año | creo~ que | es el *mejor* | One~ Million | de todos",
 5: "esto~ es | un perfume | *dulce* | *tropical* | y que | se hace | notar | *muchísimo*",
 6: "lo~ que~ sí | te tengo~ que | decir | ~es ~que ~de *Black* | no tiene | mucho | porque es~ un | perfume | que sale | ~con ~un *ananá* | jugoso | y~ a~ la media hora | se transforma | en~ una *vainilla* | más cremosa | con la mezcla | de *coco* | y un fondo | de *madera* | tostada | que lo hacen | *espectacular*",
 7: "muy dulce | eso sí | pero | yo~ no~ soy | fan~ de~ los | perfumes *dulces* | y~ eso lo saben | ustedes | los~ que~ me miran | siempre | pero este | me *conquistó* | de verdad",
 8: "los~ que~ aman | este perfume | dicen~ que | es *adictivo* | y~ que trae | *cumplidos*",
 9: "y~ los~ que~ no | le critican | que~ por~ ahí | puede~ ser | demasiado | *dulce* | *juvenil* | ~y *más de~ lo mismo*",
 10: "lo~ que~ sí | te digo | que~ es | un perfume | 100% | *nocturno* | más tirando | a *frío*",
 11: "con calor | yo lo usaría | solamente | de *noche* | si de día | solamente | si te animás",
 12: "las~ 48 | horas | en la piel | la mayoría | de~ las opiniones | incluida | la mía | habla de~ que | ~entre *8~ y~ 10* | horas",
 14: "las~ 48 | horas | se cumplen | pero solamente | [en la ropa]",
 15: "[sí señores]",
 16: "si~ te~ lo | aplicás | en ropa | te~ va~ a | quedar | *dos días* | impregnado | esta *bestia*",
 17: "me gustaría | que ustedes | me~ dejen~ en~ los | *comentarios* | qué opinan | de este | si lo aman | les gusta | lo dulce | o lo sienten | un~ poco | *empalagoso*",
 18: "personalmente | considero | que está | [aprobadísimo]",
 19: "te tiene~ que | gustar | el ananá | dulce | jugosa | y cremosa | como dije | pero | [un perfumazo]",
}

def plan():
    # ---- zooms
    zkey(0.0, 1.10, ax=980); zkey(0.40, 1.0, "out", ax=980)                   # opening settle (the reference opens 1.23 -> 1.00 in 10 frames)
    gesture(ts(0, "48 horas") - 0.05, 1.13, hold=0.9, release=2.2, ax=980)     # the hook number (bottle at the right edge: anchor there)
    gesture(ts(2, "nunca fuiste") - 0.05, 1.11, until_cut=True, ax=980)        # punchline
    gesture(ts(4, "es el mejor") - 0.05, 1.09, until_cut=True)
    gesture(ts(6, "espectacular") - 0.05, 1.09, hold=0.4, release=1.6)
    gesture(ts(7, "me conquistó") - 0.05, 1.10, until_cut=True)
    gesture(ts(11, "si te animás") - 0.05, 1.07, until_cut=True)                # the dare
    gesture(ts(14, "en la ropa") - 0.05, 1.12, hold=1.2, release=2.8)          # the pay-off
    zkey(ts(19, "pero"), 1.0, "cut"); zkey(DUR, 1.12, "inout")                # outro push-in that keeps moving over the held end frame

    # ---- gancho
    hook_tag(ts(0, "48 horas") - 0.24, "¿Dura", "48 h?")
    big_title(ts(0, "48 horas"), title_out(0, "y al final"), "48", "Horas", cx=490)
    # ---- producto
    lockup(ts(1, "One Million Black"), ts(1, "Black"), ts(1, "de Rabanne"), title_out(1, "de la mítica"), "1 MILLION", "Black", "Rabanne&nbsp;·&nbsp;<b>Lanzamiento 2026</b>")
    bottle_card(ts(1, "de la mítica") - 0.05, sent_span(1)[1] + 0.22, "fragrantica/bottle_1-million.png", "1 Million", "Desde 2008")
    rating_card(ts(4, "me parece") + 0.12, sent_span(4)[1] + 0.25, 4.3, "+1.800 votos")
    # ---- notas
    t_an, t_va, t_co, t_ma = ts(6, "ananá"), ts(6, "vainilla"), ts(6, "coco"), ts(6, "madera")
    medal("fragrantica/note_pineapple.png", "Salida", "Ananá", t_an, t_va - 0.14, 0)
    medal("fragrantica/note_vanilla.png", "Corazón", "Vainilla", t_va, t_ma - 0.14, 0, sound="pop_high")
    medal("fragrantica/note_coconut.png", "Corazón", "Coco", t_co, ts(6, "que lo hacen") - 0.05, 1)
    medal("fragrantica/note_ebony-wood.png", "Fondo", "Madera", t_ma, sent_span(6)[1] + 0.30, 0, sound="pop_high")
    # ---- a favor / en contra
    pros_cons(ts(8, "dicen que") - 0.05, sent_span(9)[1] + 0.30, ts(9, "le critican") - 0.05,
              [("Adictivo", ts(8, "adictivo")), ("Trae cumplidos", ts(8, "cumplidos"))],
              [("Demasiado dulce", ts(9, "demasiado")), ("Juvenil", ts(9, "juvenil")), ("Más de lo mismo", ts(9, "más de lo mismo"))])
    # ---- cuándo usarlo
    t = ts(11, "con calor") + 0.10
    photo_tiles(t, out_on_cut(te(11, "animás") + 0.30), [("stock/final/night.jpg", "Noche", "100% nocturno", t), ("stock/final/cold.jpg", "Frío", "Su mejor clima", t + 0.30)])
    # ---- la respuesta del gancho
    scoreboard(ts(12, "48 horas") - 0.05, te(15, "señores") + 0.30, "¿48 horas?",
               [("En piel", "8–10 h", ts(12, "8 y 10") - 0.04, 20, False), ("En ropa", "48 h", ts(14, "en la ropa") - 0.04, 100, True)])
    t = ts(14, "en la ropa")
    big_title(t, min(title_out(17, "me gustaría", 0.20), next_cut(t) - 0.19), "48", "<b>✓</b>&nbsp;Solo en ropa", unit="h", cx=490, hit=(-25.5, -24.5), riser=-26.0, label_delay=0.12)
    # ---- comentarios y cierre
    cta_card(ts(17, "en los comentarios") - 0.06, 3.7, "Comenten", "¿Lo aman<br>o los<br><i>empalaga</i>?")
    end_plate(ts(19, "un perfumazo") - 0.04, te(19, "perfumazo"), "Perfumazo.", "1 Million Black&nbsp;·&nbsp;Rabanne")
