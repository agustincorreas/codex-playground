# Estrategias intradía en acciones y ETFs de EE. UU. con evidencia verificable (relevamiento a noviembre de 2026)

Criterio: solo estrategias con reglas explícitas y backtests publicados (SSRN o revistas con referato) o réplicas públicas
con código. Se separa lo que reportan los autores de lo que encontraron replicadores independientes. Cuando no se
publica el porcentaje de aciertos, se dice.

Hallazgo transversal: ninguna de las estrategias conocidas (ORB, "noise area", primera y última media hora) tiene a la
vez más del 50 % de aciertos y esperanza positiva neta confirmada fuera de muestra. Los sistemas de ruptura aciertan
entre 20 y 48 % y pagan por convexidad; los de reversión aciertan más, pero la evidencia neta de costos es débil o no
existe.

## 1. ORB de 5 minutos en acciones en juego (Zarattini, Barbon y Aziz, 2024; SSRN 4729284)

Reglas: universo de más de 7.000 acciones (2016–2023, incluye deslistadas); precio de apertura > $5, volumen medio de
14 días ≥ 1 M, ATR14 > $0,50, volumen relativo en los primeros 5 min ≥ 100 %; se operan las 20 de mayor volumen
relativo. Orden stop en el extremo de la vela 9:30–9:35 en la dirección de la vela; stop al 10 % del ATR14; salida por
stop o al cierre; 1 % del capital por stop, apalancamiento máximo 4×; solo comisión de $0,0035 por acción, sin spread
ni deslizamiento.
Reportado: sin filtro, +29 % total, Sharpe 0,48, aciertos diarios 41,4 %. Con las top 20: +1.637 %, 41,6 % anual,
Sharpe 2,81, aciertos diarios 48,4 %, drawdown 12 %. R medio +0,08 (rvol > 100 %), +0,38 (rvol > 30×).
Réplicas: QuantConnect reprodujo la lógica solo para 2016 (Sharpe 2,40); comentaristas reportan ~17 % de aciertos por
trade y años malos. No hay réplica pública posterior a 2023 de la versión filtrada. Un estudio de falsación en MNQ
(arXiv 2605.04004, 2021–2025) no encontró ninguna variante de ORB que pase los criterios.
Nuestra réplica (results.md): con ticks y costos reales, −0,09 R por trade y 12 % de aciertos; la ventaja se apagó en
2023.
Decay: sin período fuera de muestra; riesgo de búsqueda de parámetros (4 rangos probados, se reporta el mejor).

## 2. ORB de 5 minutos en QQQ/TQQQ (Zarattini y Aziz, 2023; SSRN 4416622)

Reglas: dirección de la primera vela de 5 min, entrada al abrir la segunda, stop en el extremo opuesto, objetivo 10 R
o cierre. Reportado: QQQ ~1.795 trades, 24 % de aciertos, +0,13 R por trade, 33 % anual, Sharpe ~1,13.
Réplicas (tres, todas debilitan): en índices CFD 2015–2026, neto de spread y deslizamiento ningún mercado se distingue
de cero; en GitHub (brusco), con $0,02 de entrada y $0,04 en el stop el Sharpe cae de 1,06 a 0,23 y el 76 % de la
ganancia viene de 2022; en MNQ falla. Decay: deterioro desde 2023.

## 3. "Beat the Market": ruptura del área de ruido en SPY (Zarattini, Aziz y Barbon, 2024; SSRN 4824172)

Reglas: banda de ruido por minuto (movimiento absoluto medio desde la apertura en 14 días); cada 30 min, cierre por
arriba de la banda y del VWAP → largo, por abajo de ambos → corto; stop móvil en la banda o el VWAP; plano a las
16:00. Reportado 2007–2024: +1.985 % neto, 19,6 % anual, Sharpe 1,33, aciertos ≈ 43 %.
Réplicas (cinco): Paz (SSRN 7290621, 2026) reproduce dentro de muestra (Sharpe 1,34) y fuera de muestra
mayo 2024–marzo 2026 da +9,4 % contra +29,5 % de comprar y tener, Sharpe 0,39. Brusco (SPY 2020–2026): +2,6 pb por
trade, 41 % de aciertos, Sharpe ≈ 0 desde 2025. VigorTas en futuros: NQ rentable, ES no. Decay: el mejor
documentado de la lista; compresión clara desde 2025 en tres fuentes independientes.

## 4. Momentum intradía: primera media hora → última media hora (Gao, Han, Li y Zhou, JFE 2018)

Reglas: a las 15:30, largo SPY si el retorno desde el cierre anterior hasta las 10:00 fue positivo, corto si negativo;
cerrar a las 16:00. Reportado 1993–2013: 6,67 % anual, Sharpe 1,08, aciertos 54,4 % (días); neto del spread 4,5–6,5 %.
Baltussen y otros (JFE 2021) lo extienden a más de 60 futuros. Réplicas recientes: QuantConnect 2015–2020 Sharpe
−0,63; un registro de 2024–2026 en QQQ/SPY con 1 min no encuentra ventaja operable. Decay: alto; vive solo en
regímenes de estrés.

## 5. Reversión de apertura: retorno nocturno → primera media hora (Iwanaga y Sakemoto, 2025) y literatura asociada

Un retorno nocturno alto predice negativamente la primera media hora en índices de EE. UU.; los autores reportan
debilitamiento después de 2010. Berkman y otros (JFQA 2012): en 3.000 acciones 1996–2008, +13 pb nocturno y −13 pb
intradía en acciones de alta atención minorista; se debilita tras la decimalización y los algoritmos. Della Corte,
Kosowski y Wang (2015): reversión apertura-cierre concentrada en el primer minuto y en small caps, ilíquida tras
costos. Porcentaje de aciertos: no reportado.

## 6. Cubrir el gap en SPY

Sin paper ni backtest con costos. Los gaps chicos (< 0,25 %) se cubren el mismo día 70–80 %; los mayores a 1 % solo
26–33 %, y el retorno apertura-cierre tras un gap grande al alza es positivo. Evidencia 1/5.

## 7. "Buy on gap" transversal (E. Chan, 2013)

Comprar las 10 acciones cuya apertura cae más de 1σ bajo el mínimo previo con apertura sobre la media de 20 días;
vender al cierre. Réplicas: Sharpe 1,57 en 2008–2011 y descendente después; otra réplica da 47 % de aciertos en 3.366
trades con retorno total negativo. Decay confirmado por el propio Chan.

## 8. Reversión de fin de día transversal (Baltussen, Da y Soebhag, 2024)

A las 15:30, largo el quintil de peores retornos del día y corto el de mejores; cerrar a las 16:00. Reportado bruto
1993–2019: 9,5 % anual (ponderado por valor) a 17,3 % (equiponderado), t ≈ 10,6. Los autores admiten que con
rebalanceo diario podría no ser explotable tras costos. Porcentaje de aciertos: no reportado.

## 9. VWAP: seguimiento de tendencia (Zarattini y Aziz, 2023) y "retroceso a VWAP"

Largo sobre VWAP, corto bajo VWAP, cambio en cada cruce; QQQ/TQQQ 2018–2023 sin spread ni deslizamiento; reportado
+671 %, Sharpe 2,1. Réplica en QuantConnect: con spreads y fuera de muestra, "mucho menos emocionante"; sensibilidad
extrema al filtro de distancia mínima. Para el retroceso a VWAP no hay evidencia académica, solo backtests de
TradingView de 6 meses sin fuera de muestra. Nuestra medición (results-vwap-gap.md): −0,17 R por trade, 48 % de
aciertos. Evidencia 1/5.

## 10. Arbitraje intradía SPY/IVV

Requiere cotizaciones y latencia baja; QuantConnect 2015–2020 Sharpe −0,45 sin costos. No apto para minoristas.

## 11. Notas de Concretum 2025–2026 (sin réplica)

Señal propietaria de reversión en SPY con 74 % de aciertos teóricos (611 trades, 31 pb) que baja a 63 % ejecutando a
la apertura siguiente; "Fast Alphas" (2026): la reversión de 5 min en SPY pierde sola y solo sirve como complemento.
No publican reglas; no verificable.

## Ranking

| Estrategia | Evidencia (1–5) | Aciertos reportados | Ventaja reportada | Alcanza con 1 min | Riesgo de decay |
|---|---|---|---|---|---|
| Beat the Market (SPY, área de ruido) | 4 | 41–43 % | Sharpe 1,33 dentro de muestra; 0,39 fuera (2024–26); ≈ 0 desde 2025 | Sí | Alto (documentado) |
| ORB 5' acciones en juego | 3 | 48 % (días) | Sharpe 2,81; +0,08 R; sin fuera de muestra ni deslizamiento; nuestra réplica: −0,09 R | Sí | Alto (confirmado acá) |
| Primera → última media hora (Gao 2018) | 3 | 54 % (días) | 4,5–6,5 % anual neto 1993–2013; ≈ 0 en 2015–26 | 30 min | Alto |
| Reversión de fin de día transversal | 3 | n/r | 9,5–17,3 % anual bruto; costos probablemente lo anulan | Sí | Medio |
| ORB 5' QQQ | 3 | 24 % | +0,13 R bruto; ≈ 0 neto en tres réplicas | Sí | Alto (decaído) |
| Nocturno → primera media hora | 2 | n/r | Positivo solo en estrés; débil después de 2010 | Sí | Alto |
| Buy on gap (Chan) | 2 | 46–47 % | Negativo después de 2013 | Sí | Confirmado |
| VWAP tendencia (Zarattini) | 1 | n/r | Sharpe 2,1 declarado; refutado con spreads | Sí | — |
| Cubrir el gap en SPY | 1 | 69–80 % de "cobertura" (no es aciertos) | No documentada | Sí | — |
| Arbitraje SPY/IVV | 1 | n/r | Negativo sin latencia | No | — |

Conclusión: la única familia con réplicas independientes que confirman el período dentro de muestra es la de Zarattini
sobre SPY, y esas mismas réplicas muestran compresión de la ventaja desde 2025. Ninguna estrategia intradía
documentada combina más del 50 % de aciertos con esperanza neta positiva verificada fuera de muestra.

## Fuentes

- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4729284
- https://blog.tradoki.com/posts/opening-range-breakout-stocks-in-play-research
- https://danfin.net/opening-range-breakout-research
- https://www.quantconnect.com/research/18444/opening-range-breakout-for-stocks-in-play/
- https://www.cxoadvisory.com/?p=45379
- https://www.mql5.com/en/blogs/post/776235
- https://github.com/giovannibrusco/zarattini-2023-orb-qqq
- https://arxiv.org/abs/2605.04004
- https://concretumgroup.com/beat-the-market-an-effective-intraday-momentum-strategy-for-sp500-etf-spy/
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7290621
- https://larryswedroe.substack.com/p/when-beat-the-market-meets-the-real
- https://github.com/giovannibrusco/zarattini-2024-momentum-spy
- https://github.com/VigorTas/beat-the-market-replication
- https://quantmacro.substack.com/p/paper-review-an-effective-intraday
- https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414
- https://www.quantconnect.com/research/15348/intraday-etf-momentum/p1
- https://github.com/hongfu12321/trading-backtest/pull/3
- https://econpapers.repec.org/RePEc:eee:jfinec:v:142:y:2021:i:1:p:377-403
- https://papers.ssrn.com/sol3/Delivery.cfm/5807282.pdf?abstractid=5807282&mirid=1&type=2
- https://ideas.repec.org/a/cup/jfinqa/v47y2012i04p715-741_00.html
- https://www.cxoadvisory.com/technical-trading/overnightintraday-return-reversal-trading/
- https://academicweb.nd.edu/~zda/EOD.pdf
- https://financialnoob.substack.com/p/buy-on-gap-strategy-and-its-performance
- https://www.quantrocket.com/blog/buy-or-sell-down-gaps/
- https://www.thetrading.tools/gap-analysis
- https://concretumgroup.com/volume-weighted-average-price-vwap-the-holy-grail-for-day-trading-systems/
- https://www.quantconnect.com/forum/discussion/16706/bear-bull-traders-039-paper-on-quot-the-holy-grail-quot-not-so-fast/
- https://ideas.repec.org/a/eee/jbfina/v37y2013i9p3486-3498.html
- https://www.quantconnect.com/research/9268/intraday-arbitrage-between-index-etfs/
- https://concretumgroup.com/when-execution-delays-erode-short-term-alpha/
- https://concretumgroup.com/papers/
