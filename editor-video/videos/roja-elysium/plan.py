# Elysium Pour Homme Parfum (Roja Parfums) — reseña a cámara, frasco dorado, remera gris oscura. Tema: goldc (dorado, subtítulos centrados).
HFLIP = False                           # la toma no está espejada (ROJA se lee bien en el frasco)
END_WORD = (36, "espectacular")
EMPH = {"perdon", "carisimo", "injustamente", "duracion", "riquisimo", "herbal", "citrico", "fresco", "chispeante", "efervescente", "locura",
        "anosmia", "masculino", "amaderado", "tremenda", "perfumazo", "espectacular", "lujo"}
HIDE = {}
CAPTIONS = {
 1: "yo~ tengo | que~ pedir | *perdón* | la~ comunidad | perfumera | tiene~ que | pedirle | *perdón* | a~ este | perfume",
 4: "estoy hablando | [de Elysium de Roja de Roja Parfums]",
 5: "este~ es~ el | Elysium | Parfum | Pour Homme",
 11: "pero | qué~ es | lo~ negativo | que~ siempre | se~ decía | de~ este perfume",
 13: "[y es el tema de la duración]",
 14: "porque~ es~ un | perfume | que~ está | 800 | mil pesos | 700~ mil | 600~ mil | depende | de~ dónde | lo~ consigas",
 16: "y~ vos decís | che | quiero | que~ esto | por~ lo~ menos | me~ rinda | durante | el~ día | que~ lo~ uso | y~ mucha | gente | le~ criticaba | eso",
 19: "a~ todos | los~ que~ les | guste | el~ estilo | de~ perfumes | de~ Aventus | esto~ les~ va~ a | gustar",
 20: "porque~ es | una~ especie | de~ Aventus | más *herbal* | más *cítrico* | más *fresco* | como más | *chispeante* | más~ *efervescente*",
 23: "que~ lo | recomiendo | mucho | para primavera | verano | incluso | para verano | calor | extremo | de~ 40 | grados",
 24: "esto | una~ *locura* | y~ dura | y~ se~ siente | y | te~ genera | *anosmia*",
 32: "es~ un~ perfume | que | por~ lo~ menos | 6 horas | a~ mí~ me~ ha | durado",
 33: "y~ 6 horas | es | nada | no~ se~ le | puede pedir más | un~ perfume",
 27: "pero la gente | que~ está | a~ tu~ alrededor | lo~ sigue | sintiendo | y~ te~ sigue | diciendo | che~ qué | rico perfume | que~ tenés | puesto | qué~ es~ eso",
 28: "se~ siente | *masculino* | *fresco* | y~ *herbal* | al~ mismo | tiempo | y~ con~ algún | puntito | dulce | *amaderado*",
 31: "[así que perdón Elysium] | disculpas | por | tirarte | tan abajo | con~ el~ tema | del~ rendimiento",
 34: "está | perfecto | que~ dure | 6 horas | *espectacular*",
 35: "los~ que~ tengan | la~ posibilidad | por~ precio | de~ pagar | un~ perfume | tan costoso | dense | una~ vuelta | por~ Édition | Privée | ahí~ lo~ pueden | probar | lo~ pueden | comprar",
}

def note_card(t, t_out, kicker, html, h=260, name="note"):
    card(t, t_out, f'<div class="kicker gold pk">{kicker}</div><div class="cta-q" style="font-size:29px;line-height:1.12">{html}</div>', h, w_max=270, name=name)
    snd(t, "whoosh_short", CARD_SND, pre=0.16)

def plan():
    global POP_SND, TICK_SND, CARD_SND
    POP_SND, TICK_SND, CARD_SND = -25.5, -26.5, -26.5     # habla bajo en varios tramos: los efectos bajan con él
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    gesture(ts(3, "injustamente") - 0.05, 1.08, until_cut=True, ax=C)
    gesture(ts(13, "Y") - 0.05, 1.10, until_cut=True, ax=C)
    gesture(ts(18, "riquísimo") - 0.05, 1.07, until_cut=True, ax=C)
    gesture(ts(24, "anosmia") - 0.05, 1.09, until_cut=True, ax=C)
    gesture(ts(31, "perdón") - 0.05, 1.11, hold=0.8, release=2.0, ax=C)
    zkey(ts(36, "Perfumazo"), 1.0, "cut"); zkey(DUR, 1.05, "inout")
    # gancho: la pregunta abierta desde el cuadro 0
    hook_tag(ts(4, "Estoy") - 0.30, "Nicho", "¿Por qué<br>perdón?")
    # producto
    lockup(ts(4, "Elysium"), ts(4, "de Roja"), ts(4, "de Roja", 1), title_out(5, "Este"), "ELYSIUM", '<span style="font-size:.74em;white-space:nowrap">Pour Homme</span>', "Roja Parfums&nbsp;·&nbsp;<b>Parfum</b>", cx=C)
    brand_badge(ts(10, "marca") - 0.05, sent_span(10)[1] + 0.20, "Roja", kicker="Londres · 2011")
    # la crítica de siempre
    big_title(ts(13, "Y"), min(title_out(14, "Porque", 0.20), next_cut(ts(13, "duración")) - 0.19), "¿Dura?", "La crítica de siempre", cx=C, hit=(-26.5, -28.0))
    t = ts(14, "800") - 0.05
    card(t, sent_span(14)[1] + 0.25, f"""<div class="kicker gold pk">Precio</div>
   <div class="rate"><span class="rate-num goldtext" style="font-size:50px;white-space:nowrap">600–800</span></div>
   <div class="rate-votes">mil pesos</div>""", 230, name="precio")
    snd(t, "whoosh_short", CARD_SND, pre=0.16)
    # el otro perfume pasa un instante por detrás
    flyby("extra/bottle_aventus.png", ts(19, "Aventus") - 0.05)
    # a qué huele
    t_h, t_c = ts(20, "herbal"), ts(20, "cítrico")
    medal("fragrantica/note_clary-sage.jpg", "Perfil", "Herbal", t_h, sent_span(20)[1] + 0.25, 0)
    medal("fragrantica/note_lemon.jpg", "Perfil", "Cítrico", t_c, sent_span(20)[1] + 0.25, 1, sound="pop_high")
    # cuándo usarlo
    check_list(ts(23, "primavera") - 0.25, sent_span(23)[1] + 0.30, "Cuándo usarlo",
               [("Primavera", ts(23, "primavera")), ("Verano", ts(23, "verano")), ("Calor de 40°", ts(23, "40"))])
    # anosmia: la explicación que se recortó queda en una tarjeta
    note_card(ts(24, "anosmia") - 0.05, te(27, "sintiendo") + 0.30, "Anosmia", "Tu nariz se <i>acostumbra</i> y deja de olerlo. Los demás, no.", h=300, name="anosmia")
    medal("fragrantica/note_cedar.jpg", "Fondo", "Amaderado", ts(28, "amaderado") - 0.05, sent_span(29)[1] + 0.20, 0)
    # remate
    t = ts(31, "perdón")
    big_title(t, min(title_out(31, "disculpas", 0.20), next_cut(t) - 0.19), "Perdón", "Elysium", cx=C, hit=(-27.0, -26.0), riser=-27.5)
    scoreboard(ts(32, "Es") - 0.05, sent_span(34)[1] + 0.30, "Duración",
               [("Decían", "Poco", ts(32, "por lo menos"), 25, False), ("En mi piel", "+6 h", ts(32, "6") - 0.04, 100, True)])
    t = ts(35, "Édition") - 0.05
    card(t, sent_span(35)[1] + 0.20, '<div class="kicker gold pk">Dónde</div><div class="brand-word" style="font-size:30px;line-height:1.15;white-space:normal">Édition<br>Privée</div>', 170, w_max=240, name="tienda")
    snd(t, "whoosh_short", CARD_SND - 2.5, pre=0.16)
