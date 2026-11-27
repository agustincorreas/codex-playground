# Tom Ford — dato: neceser de cuero de regalo en la tienda oficial de Mercado Libre (frasco: Tobacco Vanille). Tema: tv (negro y dorado).
HFLIP = False                           # la toma no está espejada (la etiqueta del frasco se lee bien)
END_WORD = (3, "Libre")
EMPH = {"fanaticos", "loco", "tobacco", "vanille", "dato", "leather", "pouch", "neceser", "cuero", "stock", "duerman", "link"}
HIDE = {1: "de regalo oficial de la marca"}
CAPTIONS = {
 0: "para todos | los *fanáticos* | de Tom Ford | como yo | que estoy *loco* | con este | *Tobacco* *Vanille* | que~ me compré | hace~ un~ par | de semanas | y no paro | de usarlo | no paro | de sentírmelo | es~ una cosa | de *locos*",
}

def plan():
    C = 580; A = 620                    # centro de títulos / ancla de zoom (la cara)
    zkey(0.0, 1.08, ax=A); zkey(0.45, 1.0, "out", ax=A)
    gesture(ts(0, "loco") - 0.05, 1.08, hold=0.6, release=2.0, ax=A)
    gesture(ts(1, "dato") - 0.05, 1.07, hold=0.5, release=1.8, ax=A)
    gesture(ts(1, "de regalo") - 0.05, 1.10, until_cut=True, ax=A)
    gesture(ts(2, "duerman") - 0.05, 1.07, hold=0.6, release=1.8, ax=A)
    zkey(ts(3, "link"), 1.0, "cut", ax=A); zkey(DUR, 1.05, "inout", ax=A)
    # gancho desde el cuadro 0: la marca y la pregunta
    hook_tag(ts(0, "que estoy") - 0.10, "Tom Ford", "¿Regalo<br>oficial?")
    # el dato, punto por punto
    check_list(ts(1, "comprando") - 0.05, ts(1, "y hasta") + 1.0, "Tom Ford",
               [("Tienda oficial", ts(1, "tienda")), ("Mercado Libre", ts(1, "Mercado")),
                ("Regalo", ts(1, "regalo")), ("Hasta agotar stock", ts(1, "hasta"))])
    # el regalo
    t = ts(1, "de regalo")
    big_title(t, min(title_out(1, "y hasta", 0.20), next_cut(t) - 0.19), "Regalo", "Neceser de cuero · oficial", cx=C, hit=(-26.5, -28.0))
    # el link
    t = ts(3, "Les") - 0.04
    card(t, DUR, '<div class="kicker gold pk" style="margin-bottom:6px">Link</div><div class="tag-q">Tienda<br>oficial</div>', 170, name="link")
    snd(t, "whoosh_short", CARD_SND, pre=0.16)
