# Bharara Rey de Reyes Amarillo — unboxing y top de la línea (verde, amarillo, naranja). Camisa blanca, frasco amarillo. Tema: goldc.
HFLIP = False                           # las etiquetas se leen bien
END_WORD = (42, "primero.")
EMPH = {"unboxing", "amarillo", "verde", "naranja", "fresco", "calido", "avainillada", "especiado", "riquisimo", "cardamomo", "mandarina", "bergamota",
        "canela", "cipriol", "davana", "tonka", "vainilla", "cuero", "pachuli", "dualidad", "exquisita", "proyecta", "top", "encantan", "oud", "comentarios"}
HIDE = {}
CAPTIONS = {
 7: "[Rey de Reyes]",
 8: "[esta es la línea que sacó Bharara en este 2026] | y~ honestamente | creo | que~ es~ de~ lo | mejor | que~ ha~ sacado | en~ el~ último | tiempo",
 36: "[mi top 1 sigue siendo este] | el~ Rey | de~ Reyes | *Verde*",
 38: "[puesto número 2] | voy~ a~ tener | que~ poner | este *amarillo* | y~ creo | que~ coincide | con~ el~ top | que~ yo~ había | hecho | en~ su~ momento",
}

def seq(sent, kick, items, t_out=None, alt=False):
    """Notas de una frase; de a una en el mismo lugar (o alternando arriba/abajo con alt=True). Ninguna cruza un corte."""
    ts_ = [ts(sent, w) for _, _, w in items]; step = 2 if alt else 1
    for k, (img, name, _) in enumerate(items):
        end = (ts_[k + step] - 0.14) if k + step < len(items) else (t_out or sent_span(sent)[1] + 0.25)
        end = min(end, next_cut(ts_[k]) - 0.21)
        medal(f"fragrantica/note_{img}.jpg", kick, name, ts_[k], end, (k % 2) if alt else 0, sound="pop_high" if k % 2 else "pop_soft")

def rank(sent, phrase, n, name, t_out):
    t = ts(sent, phrase)
    big_title(t, min(t_out, next_cut(t) - 0.19), f"#{n}", name, cx=540, hit=(-26.5, -28.0))
    gesture(t - 0.05, 1.08, hold=0.4, release=1.4, ax=540)

def plan():
    global POP_SND, TICK_SND, CARD_SND
    POP_SND, TICK_SND, CARD_SND = -25.0, -26.0, -25.5
    C = 540
    zkey(0.0, 1.08, ax=C); zkey(0.40, 1.0, "out", ax=C)
    hook_title(sent_span(0)[1] + 0.15, "¿Cuál es el mejor<br><i>Rey de Reyes</i>?", top=880, size=88)
    lockup(ts(7, "Rey"), ts(7, "de"), ts(8, "Bharara"), min(ts(8, "y") - 0.20, next_cut(ts(8, "Bharara")) - 0.19), "REY", '<span style="font-size:.80em;white-space:nowrap">de Reyes</span>', "Bharara&nbsp;·&nbsp;<b>Línea 2026</b>", cx=C)
    gesture(ts(17, "riquísimo") - 0.05, 1.08, until_cut=True, ax=C)
    seq(22, "Salida", [("cardamom", "Cardamomo", "cardamomo,"), ("mandarin", "Mandarina", "mandarina,"), ("bergamot", "Bergamota", "bergamota,")], alt=True)
    seq(24, "Corazón y fondo", [("cinnamon", "Canela", "canela,"), ("tonka", "Haba tonka", "haba"), ("vanilla", "Vainilla", "vainilla,"), ("leather", "Cuero", "cuero"), ("patchouli", "Pachulí", "pachulí.")], alt=True)
    check_list(ts(32, "para", 0) - 0.30, sent_span(32)[1] + 0.30, "Para usarlo", [("De día", ts(32, "día,")), ("De noche", ts(32, "noche."))])
    rank(36, "Mi", 1, "Rey de Reyes Verde", ts(36, "el") - 0.20)
    rank(38, "Puesto", 2, "Rey de Reyes Amarillo", ts(38, "voy") - 0.20)
    flyby("extra/bottle_oud-for-glory.png", ts(39, "Oud") - 0.05)
    rank(39, "lo", 3, "Rey de Reyes Naranja", ts(39, "porque") - 0.20)
    cta_card(ts(42, "comentarios") - 0.06, 3.4, "Comenten", "¿Cuál es<br>tu <i>favorito</i>?")
