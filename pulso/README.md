# Pulso: escáner de momentum en tiempo real para small caps de EE.UU.

Escáner de acciones al estilo de Arcane Monitor, pensado para operar momentum como enseña Ross Cameron
(Warrior Trading). Recorre todo el mercado de EE.UU. y te muestra, en una sola pantalla, las acciones que
cumplen los **5 pilares**: precio, suba del día, volumen relativo, noticia y float bajo. Te avisa con
sonido o voz cuando una hace un nuevo máximo, un squeeze, un bull flag, un halt o tiene una noticia.

![Pulso en escritorio](docs/captura-escritorio.jpg)

- **Probarlo sin instalar nada:** modo demo con un mercado simulado (acciones ficticias), en
  https://agustincorreas.github.io/codex-playground/pulso/ (se publica desde `main`).
- **Practicar con plata ficticia:** una cuenta de práctica de US$ 1.000 para operar ese mercado simulado en
  tiempo real, con stop y objetivo, velas de 10 y 30 segundos y un diario que te lleva las estadísticas
  (trades ganadores y perdedores, cuánto ganaste y perdiste, % de aciertos, R, por setup y por horario).
- **Usarlo con datos reales:** corre en tu computadora y se conecta a **Alpaca** o a **Massive**
  (ex Polygon.io). Hace falta una suscripción de datos; abajo están los costos y cómo sacarla.

> Pulso es una herramienta informativa. No es asesoramiento financiero ni recomienda comprar o vender nada.

---

## 1. Qué muestra

| Panel | Qué es |
| --- | --- |
| **Top gappers** | Suben 5% o más contra el cierre anterior, precio $1–$20, volumen desde 50K. Ordenadas por % de suba. En el pre-market es la lista para armar la watchlist del día. |
| **5 pilares** | Las que cumplen 4 o 5 pilares (configurable). Cada fila muestra los pilares como casilleros: `$` precio, `%` suba, `V` volumen relativo, `N` noticia, `F` float. |
| **Momentum** | Equivalente al scanner de "máximos del día": cada señal en una fila, la más nueva arriba (nuevo máximo, squeeze, subida rápida, bull flag, ruptura del máximo del pre-market, pico de volumen). |
| **Subiendo ahora / Volumen relativo** | Las que más suben en los últimos 5 minutos y las de mayor volumen relativo. |
| **Low float / Se desinflan** | Float de hasta 20M que suben; y las que llegaron a subir 20%+ pero ya están 15%+ debajo del máximo. |
| **Halts** | Halts y reanudaciones con el motivo (pausa LULD, noticia pendiente, etc.), cuenta regresiva de 5 minutos para las pausas por volatilidad y el % de la reanudación contra el precio del halt. |
| **Alertas** | Todas las alertas, con filtros por tipo y por cantidad de pilares. |
| **Noticias** | Titulares en tiempo real (Benzinga vía Alpaca, o Massive). |
| **Gráfico** | Velas de 10 s, 30 s, 1 min y 5 min con VWAP, EMA 9, EMA 20, volumen y MACD; líneas de máximo del día, máximo del pre-market, cierre anterior y entrada/stop del bull flag; marcas de halts. En práctica, además, tus compras y ventas, tu costo, tu stop y tu objetivo. |
| **Operar** | El ticket de la cuenta de práctica (bid, ask, compra y venta a mercado, límite o stop, stop y objetivo, tamaño por riesgo) y la ficha de la acción: precio, volumen, RVOL, float, rotación, VWAP, máximos, short interest, etiquetas de dilución de la SEC, los 5 pilares con su valor y el estado del setup (VWAP, EMA 9, MACD). |
| **Posiciones / Órdenes / Watchlist** | Lo que tenés abierto con su resultado en vivo, las órdenes pendientes y tus símbolos marcados con la estrella. |
| **Rango del día** | Dónde está el precio entre el mínimo y el máximo del día de cada gapper. |
| **Diario** | Tus trades de práctica y sus estadísticas (sección 2). |

En el celular la misma información se ordena en pestañas (Escáner, Alertas, Operar, Noticias y Diario).

### Los 5 pilares (valores por defecto, se cambian en Ajustes)

| Pilar | Criterio | Por qué |
| --- | --- | --- |
| Precio | Entre US$ 1 y US$ 20 | El rango donde se mueven los small caps con momentum. |
| Ya sube | 10% o más en el día | Muestra que hay demanda real. |
| Volumen relativo | 5x o más | Se calcula contra lo normal **a esta hora** (a las 9:00 nadie hizo el volumen de un día entero). |
| Noticia | Titular en las últimas 24 h | El catalizador que explica la suba. |
| Float | Menos de 10M de acciones | Poca oferta: el precio se mueve rápido. Hasta 20M es aceptable. |

### Alertas

Nuevo máximo del día (con o sin volumen), cerca del máximo, subida rápida (+5% en 2 min), squeeze (cada
+10% en 15 min), pico de volumen (5x el promedio del minuto), compras apiladas (10 subas seguidas),
ruptura del máximo del pre-market, ruptura de medio dólar / dólar entero, **bull flag** (palo con volumen,
retroceso de 1 a 4 velas con menos volumen que no devuelve más del 50%, sobre el VWAP: avisa en la primera
vela que hace nuevo máximo y propone entrada, stop y objetivo 2:1), recupera / pierde el VWAP, rojo a verde,
flush (−12% en 5 min), halt, reanudación, noticia, entra a gappers y rotación del float (volumen ≥ float).

El sonido se activa con el botón del parlante (el navegador exige un toque). Con el micrófono las alertas se
leen en voz alta ("T R O R, squeeze"). En Ajustes elegís qué alertas suenan y desde cuántos pilares.

---

## 2. Modo práctica: operá con US$ 1.000 ficticios y llevá tus estadísticas

Como conectarse a datos reales cuesta plata, Pulso trae un **mercado simulado en tiempo real** y una
**cuenta de práctica** para operarlo. Las acciones son ficticias pero se comportan como small caps de
momentum: gaps con noticia, squeezes, bull flags, halts por volatilidad y acciones que se desinflan. Las velas se arman segundo a segundo y todo pasa en el navegador: no hay que instalar nada.

![Practicando en el escritorio](docs/practica-escritorio.jpg)

### Un día de práctica

1. Cada día simulado es un mercado distinto. Arranca a las 9:25 ET con el pre-market ya armado (o a las
   7:00, 9:00 o 9:45: se elige en *Diario → Nuevo día simulado*). Con 2x, 5x o 10x el reloj corre más rápido
   y con ⏸ se pausa.
2. Elegís una acción en los escáneres. En el panel **Operar** está el ticket: bid, ask, spread y poder de
   compra.
3. Comprás **a mercado** (al ask), con orden **límite** (a tu precio o mejor) o **stop** (cuando rompe un
   precio, para entrar en la ruptura). Con **Stop y objetivo** tildado la compra sale con un stop de pérdida
   y una venta límite en el objetivo, que se cancelan entre sí (OCO).
4. El ticket propone el stop un centavo debajo del mínimo de la vela de 1 minuto anterior (el mínimo del
   retroceso, o el stop del bull flag si hay uno armado) y el objetivo a 2R; la propuesta se actualiza con
   cada vela hasta que la cambiás a mano, y **Sugerir** la vuelve a calcular. El botón **Riesgo US$ 20**
   calcula cuántas acciones comprar para perder como mucho eso si toca el stop. Si la orden supera tu poder
   de compra, te avisa cuántas acciones te alcanzan.
5. Salís con **Vender ½** o **Vender todo** (al bid), en el objetivo o en el stop. **Stop a break even** sube
   el stop a tu precio de entrada.
6. En el gráfico ves tus compras (C) y ventas (V), tu costo, tu stop y tu objetivo. Para entrar y salir
   rápido conviene mirar las velas de 10 o 30 segundos.
7. A las 15:59 ET el día se cierra solo (vende lo que quedó abierto), o lo cerrás antes con *Terminar el
   día*. El saldo pasa al día siguiente.

**Atajos de teclado** (con una acción elegida): **B** compra con lo que dice el ticket, **S** vende todo,
**H** vende la mitad y **Esc** cancela las órdenes pendientes.

### Qué tan real es la ejecución

- A mercado se compra al ask y se vende al bid. El spread es más ancho en las acciones baratas, en los
  movimientos rápidos y fuera de la rueda (pre-market).
- **Deslizamiento** según tu tamaño contra lo que la acción opera por minuto: 100 acciones en una que mueve
  50.000 por minuto casi no se notan; 5.000 en una que mueve 2.000 por minuto pagan bastante más que el ask.
- Durante un **halt** no se ejecuta nada, tampoco los stops. Si reanuda más abajo, el stop sale al precio de
  la reanudación, como en la realidad.
- La cuenta es **cash**: solo comprás con lo que tenés. En *Ajustes de práctica* se cambia el saldo inicial,
  se pasa a margen 2x o 4x, se agregan comisiones (por ejemplo US$ 0,005 por acción, como IBKR Pro) y se
  fija una **pérdida máxima del día** que bloquea nuevas compras cuando la alcanzás.
- Solo compras (long), sin ventas en corto: es el estilo de Ross Cameron en small caps.

### Diario y estadísticas

Se abre con el botón de la cuenta (arriba, el que muestra el saldo) o con la pestaña *Diario* en el celular.

![Diario de trading con las estadísticas](docs/practica-diario.jpg)

- **Equity**, resultado del día y resultado total desde el saldo inicial.
- **Trades ganadores y perdedores**, % de aciertos, ganancia y pérdida promedio (y la mayor de cada una),
  relación ganancia/pérdida, profit factor, R promedio, esperanza por trade, máximo drawdown, rachas y
  tiempo promedio en el trade.
- **Curva de capital** y consejos automáticos: por ejemplo, si tus pérdidas promedio son más grandes que tus
  ganancias, si mantenés las perdedoras más tiempo que las ganadoras, si entrás sin stop o qué horario y qué
  setup te cuestan plata.
- **Desglose** por setup, horario, precio, float, cantidad de pilares y motivo de salida, para saber qué te
  funciona y qué no.
- **Lista de trades** con hora, entrada, salida, resultado en US$ y en %, R, minutos y motivo de salida.
  Podés corregir el setup y anotar qué aprendiste; **Ver** abre el gráfico del trade con tus entradas y
  salidas y cuánto llegó a ir a favor y en contra (MFE/MAE).
- Filtros por hoy, últimos 7 días, todo o un día en particular, y la tabla de días anteriores.

### Dónde se guarda

- **En el artifact de Claude:** en tu cuenta de Claude. Es privado (si compartís el link, cada persona tiene
  su propia cuenta de práctica) y lo ves desde cualquier dispositivo.
- **En la demo de GitHub Pages o en tu computadora:** en el navegador. Si borrás los datos del sitio, se
  pierden.

Si cerrás la pestaña en medio de un día, al volver se reanuda el mismo mercado en el mismo minuto, con tus
posiciones y órdenes. Con datos reales (secciones 3 y 4) la misma cuenta de práctica opera sobre el mercado
de verdad: precios reales, con el bid y el ask estimados porque el escáner no recibe el libro de órdenes.

---

## 3. ¿Hace falta pagar los datos en tiempo real? Sí. Cuánto sale y cómo se saca

No hace falta suscribirse a la bolsa directamente: se contrata a un **proveedor de datos** que cobra los
derechos de las bolsas (NYSE, Nasdaq, Cboe). Para un particular que opera su propia plata, esos derechos son
la tarifa de **"no profesional"**, que es baja; el proveedor cobra su abono encima. Precios verificados en
octubre de 2026:

| Opción | US$/mes | ¿Tiempo real? | Para qué sirve |
| --- | --- | --- | --- |
| **Alpaca — Algo Trader Plus** | **99** | Sí, SIP (todas las bolsas) | **La opción más barata que cubre todo el mercado.** Incluye halts, LULD y noticias Benzinga en tiempo real. |
| **Massive — Stocks Advanced** | **199** (20% menos pagando anual) | Sí | La más completa: agregados de cada segundo de todas las acciones, snapshot desde las 4:00 ET, float y short interest. Las noticias de Benzinga son un agregado de US$ 99. |
| Massive — Stocks Starter | 29 | No (15 min de demora) | Para probar todo el sistema con datos reales, demorados. |
| Alpaca — Basic | 0 | Solo la bolsa IEX (~2–3% del volumen) | Para probar la conexión. El volumen y el RVOL quedan incompletos: no sirve para operar. |
| Massive — Basic | 0 | No (fin del día) | **Float y short interest gratis**: conviene cargar esta clave aunque uses Alpaca. |
| Interactive Brokers | 4,50 (no profesional) | Sí, hasta 100 símbolos a la vez | Excelente como bróker, pero no alcanza para escanear todo el mercado. |

**Recomendación:** Alpaca Algo Trader Plus (US$ 99) + la clave gratis de Massive para el float + los halts
del RSS de Nasdaq y la SEC (gratis, ya incluidos en Pulso). Si Alpaca no te aprueba la cuenta, Massive
Stocks Advanced (US$ 199) funciona solo.

Para comparar con herramientas hechas: Arcane Monitor cuesta US$ 35/mes y no pide una suscripción de datos aparte; Day Trade
Dash de Warrior Trading, US$ 147–197/mes; Trade Ideas, US$ 127–254/mes; Benzinga Pro, US$ 37–197/mes. Armar
el escáner propio sale más en datos que Arcane, pero es tuyo: sin límites, configurable y extensible.

### Cómo sacar Alpaca (US$ 99/mes)

1. Creá la cuenta en https://app.alpaca.markets con tu email. Te da una cuenta *paper* (simulada), las claves
   de API y los datos gratis de IEX: con eso ya podés probar Pulso (`ALPACA_FEED=iex`).
2. Para contratar los datos completos Alpaca pide **abrir la cuenta real** (no hace falta operar con ella):
   pasaporte, comprobante de domicilio, tu CUIT/CUIL como identificación fiscal y el formulario W-8BEN.
   Alpaca no publica una lista de países; si te rechaza el país, escribí a support@alpaca.markets.
3. En el dashboard: **Plans & Features → Market Data → Algo Trader Plus**. Se paga con tarjeta internacional
   en dólares (tu banco puede sumar percepciones por consumos en el exterior).
4. Copiá las claves al archivo `.env` y poné `ALPACA_FEED=sip`. Si el feed SIP no te autoriza con las
   claves de paper, generá las de la cuenta real (Pulso detecta solo a qué servidor corresponden).

### Cómo sacar Massive (US$ 199/mes, o gratis solo para el float)

1. Creá la cuenta en https://massive.com: la clave gratuita (Basic) ya da float y short interest.
2. Para tiempo real, contratá **Stocks Advanced**. Respondé con cuidado el cuestionario de "no profesional":
   no se puede revertir.
3. **Firmá los acuerdos de las bolsas** en el dashboard; sin eso los datos llegan demorados.
4. En `.env`: `MASSIVE_API_KEY=...` y `MASSIVE_PLAN=advanced` (o `starter` para probar con demora).

### Profesional o no profesional

Sos **no profesional** si operás tu propia plata, a tu nombre, sin estar registrado ante la SEC, la CNV u
otro regulador y sin manejar dinero de terceros. Ser profesional multiplica el costo de cada bolsa (US$ 25–45
por bolsa por mes en vez de ~US$ 1). Desde abril de 2027 (nuevo plan del consolidated tape) operar a través
de una sociedad también cuenta como uso profesional.

**Importante:** los planes personales son para uso propio. Mostrar los datos a otros (transmitir la pantalla
en YouTube o Discord, o vender acceso como hacen Arcane o Stocks Rocks) es *redistribución* y requiere
licencias de las bolsas (desde ~US$ 1.000/mes por bolsa) y planes comerciales del proveedor (por ejemplo,
Massive Business desde US$ 2.499/mes).

Fuentes: [Alpaca, planes de datos](https://docs.alpaca.markets/docs/about-market-data-api) ·
[Massive, precios](https://massive.com/pricing) · [Massive, float](https://massive.com/docs/rest/stocks/fundamentals/float) ·
[IBKR, datos de mercado](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php) ·
[Arcane Monitor](https://www.arcanemonitor.com/pricing) · [Day Trade Dash](https://www.warriortrading.com/day-trade-dash/) ·
[Trade Ideas](https://www.trade-ideas.com/pricing/) · [Plan UTP (no profesional)](https://www.utpplan.com/DOC/Datapolicies.pdf).

---

## 4. Instalación (una vez, ~10 minutos)

1. Instalá **Node.js 20 o más nuevo** desde https://nodejs.org (botón "LTS").
2. Bajá el código (botón verde **Code → Download ZIP** en GitHub, o `git clone`) y abrí una terminal en la
   carpeta `pulso`.
3. Instalá y arrancá:

```bash
cd pulso
npm install
cp .env.example .env      # en Windows: copy .env.example .env
npm start
```

4. Abrí http://localhost:8787. Sin claves arranca en **modo demo** (mercado simulado en el servidor).
5. Completá `.env` con tus claves (ver la sección 3) y reiniciá con `npm start`. En la consola vas a ver el
   progreso: lista de acciones, snapshots, volumen promedio, velas del día y la conexión al streaming. Las
   claves quedan en tu computadora: la interfaz nunca las recibe.

**Desde el celular:** poné `HOST=0.0.0.0` en `.env`, reiniciá y abrí `http://IP-DE-TU-PC:8787` con el
celular conectado a la misma red Wi-Fi.

| Variable | Para qué |
| --- | --- |
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_FEED` | Alpaca (`iex` gratis o `sip` pago). |
| `MASSIVE_API_KEY`, `MASSIVE_PLAN` | Massive (`basic`, `starter`, `developer` o `advanced`). |
| `SEC_USER_AGENT` | "Tu Nombre tu@email.com": activa las etiquetas de dilución de la SEC (S-1, shelf S-3, 424B, 8-K 3.02) y las acciones en circulación. |
| `FMP_API_KEY`, `FLOAT_CSV` | Fuentes alternativas de float (Financial Modeling Prep o tu propio CSV). |
| `UNIVERSE_MIN_PRICE`, `UNIVERSE_MAX_PRICE` | Rango de precio de las acciones que se siguen (por defecto $0,20–$60). |

Cada día a las 4:00 ET el servidor recarga los cierres y el volumen promedio solo. Las descargas pesadas
(volumen promedio, float) se guardan en `pulso/.cache` para que reiniciar sea rápido.

### De dónde sale cada dato

| Dato | Alpaca | Massive |
| --- | --- | --- |
| Precios y volumen | Velas de 1 min de todo el mercado + prints tick a tick de las ~400 acciones calientes | Agregados de 1 s de todo el mercado |
| Cierre anterior y volumen promedio | Snapshots + velas diarias de 30 ruedas | Cierres diarios agrupados de 30 ruedas + snapshot |
| Halts | Canal `statuses` + RSS de Nasdaq | RSS de Nasdaq + LULD |
| Noticias | Benzinga en tiempo real (websocket) | API de noticias de Massive (cada 3 min) |
| Float / short interest | Massive gratis, FMP o CSV; si no hay, acciones en circulación de la SEC (≈) | Massive |
| Dilución | SEC EDGAR (si definís `SEC_USER_AGENT`) | SEC EDGAR |

---

## 5. Cómo se usa con el método de los 5 pilares

1. **Pre-market (7:00–9:30 ET):** mirá *Top gappers* y *5 pilares*. Abrí la ficha de cada candidata: noticia,
   float, RVOL y etiquetas de dilución (un 424B o un S-1 reciente suele significar que la empresa está
   vendiendo acciones). Marcá con la estrella las mejores y fijate el máximo del pre-market en el gráfico.
2. **Apertura (9:30–11:00 ET):** el panel *Momentum* y las alertas sonoras te avisan cuando una de esas
   acciones hace un nuevo máximo, un squeeze o arma un bull flag. Los halts al alza y su reanudación aparecen
   en *Halts* con la cuenta regresiva.
3. **Antes de entrar:** revisá el *Setup* de la ficha (sobre el VWAP, sobre la EMA 9, MACD a favor) y armá la
   orden en el ticket: con el stop en el mínimo del retroceso, el botón *Riesgo* te dice cuántas acciones
   comprar para no perder más que tu máximo, y la línea de abajo muestra si el objetivo da 2:1. Si no hay un
   2:1 razonable, no hay trade.

Para practicar sin arriesgar plata está el modo práctica (sección 2). Ross Cameron recomienda practicar en
simulador hasta que las estadísticas den positivas de forma consistente antes de operar con plata real.

---

## 6. Para desarrolladores

```
pulso/
  src/engine/   motor del escáner (sin dependencias: corre igual en el navegador y en Node)
    engine.ts     estado por símbolo, escáneres, halts, noticias, ficha
    alerts.ts     reglas de alerta y detección de bull flag
    metrics.ts    RVOL ajustado por horario, 5 pilares, filas de los escáneres
    symbol.ts     velas de 1 min, VWAP, EMA/MACD incrementales
    time.ts       hora ET, sesiones, feriados NYSE 2025–2027, curva de volumen intradía
  src/sim/      mercado simulado (gappers, runners con noticia, halts LULD, fades); determinista por semilla
  src/trading/  cuenta de práctica (sin dependencias)
    broker.ts     órdenes a mercado, límite y stop, OCO, spread y deslizamiento, halts, margen, comisiones
    stats.ts      estadísticas del diario, curva de capital y desgloses
    store.ts      guardado en el navegador o en la base del artifact de Claude
  src/client/   interfaz React + lightweight-charts (TradingView)
    training.ts   días de práctica: crear, reanudar, terminar y guardar
  server/       servidor Node: Alpaca, Massive, halts de Nasdaq, SEC, float; WebSocket hacia la interfaz
  test/         pruebas (motor, adaptadores con mensajes de la documentación oficial, servidores falsos)
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Interfaz en modo demo con recarga en caliente (http://localhost:5173). |
| `npm start` | Compila la interfaz y arranca el servidor (datos reales si hay claves). |
| `npm test` | Pruebas (54): motor, alertas, bull flag, halts, Alpaca y Massive contra servidores falsos, simulador y cuenta de práctica. |
| `npm run typecheck` | Chequeo de tipos de todo el proyecto. |
| `npm run build:demo` | Página única del demo (`dist-demo/index.html`) para GitHub Pages. |

### Límites conocidos

- Con el plan gratis de Alpaca (IEX) el volumen en vivo es solo de esa bolsa: sirve para probar, no para operar.
- El float de los proveedores se actualiza con demora; después de un split inverso o una oferta puede estar
  desactualizado unos días. Las acciones en circulación de la SEC no se ajustan por splits (se muestran con ≈).
- Las etiquetas de dilución son heurísticas sobre los formularios presentados a la SEC: confirmá leyendo el filing.
- El bull flag es una detección automática simple sobre velas de 1 minuto. Es una ayuda para mirar, no una señal de compra.
- El simulador sirve para entrenar la lectura del gráfico, la disciplina y el manejo del riesgo, pero sus
  movimientos los genera un modelo: no hay libro de órdenes (nivel 2) ni cinta, y la ejecución es una
  aproximación. Un resultado positivo en práctica no garantiza el mismo resultado con plata real.
