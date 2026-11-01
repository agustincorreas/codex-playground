# ORB en "acciones en juego": réplica con datos reales (2021-01 → 2026-10)

Pregunta: ¿la ruptura del rango de apertura de 5 minutos en acciones en juego (Zarattini, Barbon y Aziz, 2024)
sirve para una app hermana de Pulso con más del 50 % de trades ganadores y esperanza positiva?

Respuesta corta: **no, tal como está publicada**. Con las reglas exactas del paper, su mismo universo y velas reales
de 1 minuto con la vela de entrada resuelta por las operaciones reales (ticks), el resultado por trade es:

| Lectura | R promedio por trade | Aciertos | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| Costos del paper (0,35 ¢ por acción, sin deslizamiento) | +0,07 R | 13 % | +0,18 | +0,18 | +0,01 | +0,02 | +0,02 | +0,02 |
| Costos realistas (1 ¢ por acción + 0,01 % por lado) | −0,09 R | 12 % | +0,02 | +0,03 | −0,17 | −0,16 | −0,14 | −0,13 |

La ventaja que describe el paper existió en 2021 y 2022 y desapareció desde 2023, incluso con sus costos. Con
costos realistas pierde plata todos los años desde 2023. Y el porcentaje de aciertos es de 12 a 14 %: la estrategia
vive de pocos ganadores enormes (8 R promedio), lo contrario de lo que se busca.

## Cómo se midió

- Datos: Alpaca, feed SIP histórico. Velas diarias de 4.977 acciones comunes (sin ETFs ni fondos), primera vela de
  5 min de todas las elegibles cada día, velas de 1 min del día entero de las 20 "en juego", y las operaciones
  (ticks) del minuto de entrada cuando la vela de 1 min no alcanza para decidir.
- Universo y selección (`fetch-paper.ts`), igual que el paper: precio de apertura > $5, volumen promedio de 14 días
  ≥ 1.000.000 de acciones, ATR de 14 días > $0,50, volumen relativo de la primera vela de 5 min ≥ 1 (contra el
  promedio de las primeras velas de los 14 días previos), las 20 de mayor volumen relativo. 1.459 días, 23.527 trades.
- Reglas (`backtest.ts`): orden stop en el máximo (vela de apertura verde) o mínimo (roja) de la vela de 9:30–9:35,
  en ambos sentidos; stop de pérdida a 0,1 × ATR desde la entrada; salida al cierre (16:00) si no saltó el stop.
  Variantes: stops de 0,25 y 0,5 × ATR o el otro extremo de la vela de apertura; objetivos de 1, 2 y 3 R;
  solo largos; solo primera hora; stop a la entrada; solo las 5 más en juego; volumen relativo ≥ 3.
- Vela de entrada: con un stop de 0,1 × ATR, en 1 de cada 17 entradas la misma vela de 1 min que dispara la orden
  también toca el stop. Esa ambigüedad vale 0,6 R por trade en promedio (pesimista −0,33 R, optimista +0,25 R), así
  que se bajaron las operaciones reales de esos minutos (2.756 minutos, `ticks.ts`) y se decidió con la secuencia
  real, ignorando lotes impares y prints fuera de secuencia, que no disparan órdenes stop.
- Tamaño: 0,5 % del capital en riesgo por trade, tope 20 % del capital por posición. Sin apalancamiento.
- Limitación: el listado de activos de Alpaca es el actual; las acciones deslistadas antes de hoy no están
  (sesgo de supervivencia, que juega a favor de la estrategia, no en contra).

## Tablas completas

- `results-paper.md`: 46 variantes con la selección del paper, total y por año.
- `results-top1000.md`: las mismas con una selección alternativa (las 1.000 de mayor volumen en dólares del año).
  Da lo mismo: +0,11 R con costos del paper, −0,04 R con costos reales, y también se apaga desde 2023.
- `analyze-*.md`: la ventaja por volumen relativo, ranking, gap, tamaño de la vela de apertura, precio, hora de
  entrada, lado, dirección de SPY y año.

## Lo que sí se aprende

1. **El porcentaje de aciertos lo fija la salida, no la entrada.** Con objetivo de 1 R y stop en el otro extremo de
   la vela de apertura, el ORB gana el 51 % de las veces en los seis años (49 a 52 % cada año), pero la esperanza es
   −0,01 R: gana 0,80 R y pierde 0,84 R. Un 51 % sin ventaja.
2. **Los filtros no crean ventaja.** Volumen relativo alto, gap a favor, SPY a favor, primera hora, top 5: ningún
   grupo con muestra razonable supera +0,02 R con objetivo 1 R, ni en 2023–2026 con stop corto. El único bolsillo con
   algo es volumen relativo ≥ 30× (507 trades en seis años, 1 cada 3 días): +0,19 R con stop 0,25 × ATR y 21 % de
   aciertos. Demasiado poco para una app.
3. **Los stops cortos del paper no se pueden operar con velas.** El resultado publicado depende de qué pasa dentro
   del minuto de entrada; con ticks reales la mitad de esa "ventaja" se evapora, y los costos reales se llevan el
   resto.
4. **La infraestructura queda.** Universo rodante, velas de 1 min de 1.459 días, ticks a pedido y un backtester con
   costos y tamaño por riesgo: probar otra estrategia intradía cuesta una hora, no una semana.

## Qué sigue

La app hermana no debería construirse sobre el ORB publicado. Las opciones, en orden de preferencia:

1. Probar con la misma infraestructura dos familias que sí apuntan a > 50 % de aciertos con ventaja: el retroceso
   a VWAP en acciones en juego (la estrategia que el propio Aziz opera) y la reversión del gap de apertura (vender
   la extensión del gap cuando falla la primera vela). Cada una se mide en un par de horas.
2. Si ninguna mide, el 50 % se busca como lo hace Pulso con el perfil Ross: objetivo corto, salida rápida, y el
   número real sale de la semana en automático.
