# Top Oreiro Love (Guapa, Brava, Bombón) — tres frascos sobre la mesa, camisa celeste. Tema: rose (rosa viejo, subtítulos centrados y más arriba).
HFLIP = True                            # selfie espejada ("Oreiro" se lee al revés en el crudo)
END_WORD = (20, "suyo")
EMPH = {"fresco", "intenso", "dulce", "frambuesa", "mandarina", "jazmin", "magnolia", "sandalo", "almizcle", "litchi", "rosa", "pachuli", "benjui",
        "almendra", "leche", "ruibarbo", "cedro", "noche", "empalagoso", "sorprendio", "comentarios"}
HIDE = {}
CAPTIONS = {
 0: "si~ sos mujer | y~ querés | oler bien | por menos | de~ 30.000 | pesos | mirá | este video | porque~ te~ va~ a | servir",
 1: "estos son | los~ tres | perfumes | [de Oreiro Love la línea de Natalia Oreiro] | se~ llaman | Guapa | Brava | y~ Bombón",
 2: "y~ aunque | los~ tres | van | por~ el~ lado | *dulce* | son bastante | distintos | entre~ sí",
 3: "[Guapa que es este que tengo acá] | es~ el~ más | *fresco* | y~ el~ más | fácil | de~ usar | de~ todos",
 4: "arranca | con~ *frambuesa* | *mandarina* | bien arriba | bien brillante | una~ salida | frutal | pero~ liviana",
 5: "y~ al~ rato | se~ vuelve | más~ floral | con~ *jazmín* | y~ *magnolia*",
 6: "pero cuando | se~ asienta | cuando | seca | queda~ un~ fondo | suave | de~ *sándalo* | y~ *almizcle*",
 7: "es~ para | el~ día | a~ día | para~ ir | a~ trabajar | para cuando | hace calor | o~ cuando | no~ sabés | qué~ ponerte",
 8: "[Brava en cambio es bastante más intenso]",
 9: "también~ abre | con~ *frambuesa* | pero acá | viene~ acompañada | de~ *litchi* | que~ es~ una | fruta | medio ácida",
 11: "lo~ que~ le | da carácter | es~ el~ fondo | de~ *pachulí* | y~ *benjuí* | que~ es~ lo | que~ lo~ hacen | cálido | y~ le~ da | una~ presencia | con~ un~ toque | amaderado",
 12: "este~ es~ un | perfume | que~ usaría~ más | para la *noche* | o~ para salir",
 13: "[y Bombón es el más dulce de los tres]",
 14: "tiene~ un~ corazón | de~ *almendra* | y~ *leche* | que~ le~ da | una~ sensación | cremosa | casi | de~ postre",
 15: "y~ lo~ bueno | es~ que~ arriba | tiene manzana | verde | y~ *ruibarbo* | que~ le~ dan | algo~ de~ frescura | y~ hacen | que~ no~ resulte | *empalagoso*",
 16: "de~ fondo | cuando | seca | quedan | el~ *almizcle* | y~ el~ *cedro*",
 17: "y~ es~ el | que~ más | me~ *sorprendió* | de~ los~ tres | por~ cómo | está | logrado | para~ lo~ que | cuesta",
 20: "se~ consiguen | en~ perfumería | y~ me~ gustaría | que~ vayan | los~ prueben | y~ después | me~ dejen | en~ los~ *comentarios* | cuál | es~ el~ suyo",
}
TT = 890                                # los títulos van sobre el pecho: abajo están los frascos

def notes(sent, kick, a, b=None, t_out=None):
    """Las notas de una frase, de a una en el mismo lugar (abajo las taparía el frasco que sostiene). a, b = (imagen, nombre, palabra)."""
    t_out = t_out or sent_span(sent)[1] + 0.25
    ta = ts(sent, a[2]); tb = ts(sent, b[2]) if b else None
    if b: ta = min(ta, tb - 0.85)
    medal(f"fragrantica/note_{a[0]}.jpg", kick, a[1], ta, (tb - 0.14) if b else t_out, 0)
    if b: medal(f"fragrantica/note_{b[0]}.jpg", kick, b[1], tb, t_out, 0, sound="pop_high")

def plan():
    global POP_SND, TICK_SND, CARD_SND
    POP_SND, TICK_SND, CARD_SND = -25.0, -26.5, -25.5     # un poco más abajo: varias notas caen sobre palabras dichas suave
    C = 540
    zkey(0.0, 1.07, ax=C); zkey(0.40, 1.0, "out", ax=C)
    for s, w in ((3, "Guapa,"), (8, "Brava,"), (13, "Bombón")):
        gesture(ts(s, w) - 0.05, 1.08, hold=0.5, release=1.6, ax=C)
    gesture(ts(17, "sorprendió") - 0.05, 1.07, until_cut=True, ax=C)
    # gancho
    hook_title(te(0, "pesos,") + 0.30, "Oler bien por<br><i>menos de $30.000</i>", top=800, size=84)
    lockup(ts(1, "Oreiro"), ts(1, "Love,"), ts(1, "Love,") + 0.15, title_out(1, "se"), "OREIRO", "Love", "Natalia Oreiro&nbsp;·&nbsp;<b>3 perfumes</b>", cx=C, top=TT)
    # Guapa
    t = ts(3, "Guapa,")
    big_title(t, title_out(3, "es", 0.22) if False else ts(3, "es", 1) - 0.22, '<span style="font-size:.80em">Guapa</span>', "1 · El más fresco", cx=C, top=TT, hit=(-26.5, -28.0))
    notes(4, "Salida", ("raspberry", "Frambuesa", "frambuesa,"), ("mandarin", "Mandarina", "mandarina,"))
    notes(5, "Corazón", ("jasmine", "Jazmín", "jazmín"), ("magnolia", "Magnolia", "magnolia,"))
    notes(6, "Fondo", ("sandalwood", "Sándalo", "sándalo"), ("musk", "Almizcle", "almizcle."))
    check_list(ts(7, "Es") - 0.05, sent_span(7)[1] + 0.25, "Guapa · Cuándo", [("Día a día", ts(7, "día")), ("Trabajo", ts(7, "trabajar,")), ("Calor", ts(7, "calor"))])
    # Brava
    t = ts(8, "Brava,")
    big_title(t, min(sent_span(8)[1] + 0.10, next_cut(t) - 0.19), '<span style="font-size:.80em">Brava</span>', "2 · El más intenso", cx=C, top=TT, hit=(-26.5, -28.0))
    notes(9, "Salida", ("raspberry", "Frambuesa", "frambuesa,"), ("litchi", "Litchi", "litchi,"))
    notes(10, "Corazón", ("rose", "Rosa", "rosa,"))
    notes(11, "Fondo", ("patchouli", "Pachulí", "pachulí"), ("benzoin", "Benjuí", "benjuí,"))
    check_list(ts(12, "Este") - 0.05, sent_span(12)[1] + 0.25, "Brava · Cuándo", [("Noche", ts(12, "noche")), ("Salidas", ts(12, "salir."))])
    # Bombón
    t = ts(13, "Bombón")
    big_title(t, min(sent_span(13)[1] + 0.10, next_cut(t) - 0.19), '<span style="font-size:.80em">Bombón</span>', "3 · El más dulce", cx=C, top=TT, hit=(-26.5, -28.0))
    notes(14, "Corazón", ("almond", "Almendra", "almendra"), ("milk", "Leche", "leche"))
    notes(15, "Salida", ("green-apple", "Manzana verde", "manzana"), ("rhubarb", "Ruibarbo", "ruibarbo,"))
    notes(16, "Fondo", ("musk", "Almizcle", "almizcle"), ("cedar", "Cedro", "cedro."))
    cta_card(ts(20, "comentarios") - 0.06, 3.0, "Comenten", "¿Cuál<br>es el<br><i>tuyo</i>?")
