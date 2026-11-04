# The Sound of Money — el mercado hecho música

Una pieza generativa, visual y sonora, que convierte la sesión de la bolsa de Nueva York en música.
Corre 100 % en el navegador con Web Audio y canvas, sin dependencias ni build: abrí `index.html`
desde un servidor local o entrá a https://agustincorreas.github.io/codex-playground/sound-of-money/.

- **El SPY es la orquesta.** El ETF del S&P 500 resume el mercado entero y decide la tonalidad, el
  modo, el tempo, los acordes, el bajo y el pulso de cada minuto.
- **Cada acción es un solista.** La acción enfocada en ese momento toca encima de la orquesta con
  su propio instrumento según el sector, su registro según el precio, su densidad según el volumen
  y su modo según cómo le va frente al mercado.
- **Las demás son un coro.** Las acciones que no están enfocadas aparecen como una constelación
  y suenan de lejos, con un cristal, cuando hacen un movimiento grande.
- **Un director automático** elige a quién enfocar: la acción con más volumen relativo y más
  movimiento en los últimos minutos. También se elige a mano tocando una estrella.

Trae **dos días reales** (velas intradía de [Massive](https://massive.com), sesión regular de
9:30 a 16:00 ET), un **generador de días inventados** y un **modo en vivo** con tu propia API key
de Massive.

## Cómo se traduce el mercado a música

Cada minuto de mercado es un compás de 4 tiempos. A 1× un día entero dura entre 15 y 25 minutos
según la volatilidad; con la velocidad 2× o 3× se escucha en menos.

### La orquesta (SPY)

| Dato del SPY | Decisión musical |
| --- | --- |
| Día (semilla) | Tonalidad: la raíz se elige a partir de la fecha, así cada día tiene su tono. |
| Cambio del día y pendiente de los últimos 15 min | **Modo**: lidio (luminoso) si sube fuerte · jónico (sereno) · mixolidio / dórico (plano, arriba o abajo del VWAP) · eólico (melancólico) · frigio (sombrío) · locrio (pánico: cae con mucha volatilidad). Cambia recién tras 3 minutos seguidos para no parpadear. |
| Rango medio de la vela (volatilidad) | **Tempo**: de 62 a 134 bpm. |
| Vela sube o baja | **Progresión de acordes**: velas que suben tienden a IV y V; las que bajan a vi y ii. El acorde dura 2 compases, salvo que el minuto sea fuerte (movimiento o volumen) y lo adelante. |
| Volumen relativo | Más voces en el acorde (7ª, 9ª), cuerdas por arriba, más capas de percusión, filtro más abierto. |
| Posición del precio en el rango del día | Inversión del acorde: más alto en el rango, voicing más agudo. |
| Máximo / mínimo nuevo del día | Un brillo agudo o un soplo grave de bronces. |
| Apertura y cierre | La campana de Wall Street. |

### El solista (la acción enfocada)

| Dato de la acción | Decisión musical |
| --- | --- |
| Sector | **Instrumento y fraseo**: internet → arpa en arpegios · software → pulso digital · semis → cristal FM a motor · biotecnología y farma → coro etéreo rubato · petróleo y marítimo → bronces sostenidos · bancos → piano eléctrico con swing · cripto → chip con glitch · consumo → marimba en tresillo · automotriz → metal a motor · minería → gong · hardware → órgano. |
| Precio | **Registro**: un dólar suena dos octavas más agudo que cien dólares. Las micro caps son livianas y agudas; las mega caps, graves. |
| Camino de la vela (apertura → mínimo → máximo → cierre) | **Melodía**: el precio se mapea a los grados de la escala del momento dentro de la ventana de los últimos 20 minutos. |
| Volumen relativo | **Densidad**: de una nota por compás a dieciséis. Un pico de volumen de 3× es un "golpe" con platillo y destello. |
| Rango de la vela frente al rango habitual | Velocidad (intensidad), vibrato y notas cromáticas de paso. |
| Fuerza relativa frente al SPY | **Modo propio**: si le va mucho mejor que al mercado, toca en un modo más luminoso que la orquesta; si le va peor, en uno más oscuro. Así una acción que se desploma en un día alcista suena frigia sobre un fondo lidio. |
| Máximo / mínimo nuevo del día | Un remolino ascendente o descendente de cuatro notas. |

### Modo progresión de acordes

En el menú ⋯ (o con la tecla `P`) el estilo pasa de *libre* a **progresión de acordes**. En vez
de la armonía generativa, la orquesta toca un **loop de cuatro acordes** y cada minuto avanza un
acorde. La progresión se elige según el ánimo del mercado (el modo): en jónico suenan las de
siempre (I–V–vi–IV, I–vi–IV–V, vi–IV–I–V…), en lidio las flotantes (I–II–I–II, I–V–II–IV), en
mixolidio las de rock (I–♭VII–IV–I), en dórico las modales (i–IV–i–IV), en eólico las menores
(i–VI–III–VII, i–VI–iv–v), en frigio las oscuras (i–♭II–i–♭II) y en locrio las inestables. Cambia
cuando cambia el modo o cada cuatro vueltas, y con mucho volumen entran las variantes más movidas.

- El **volumen relativo** decide cómo se toca el acorde: en calma, en bloque (piano eléctrico o
  cuerdas); con actividad media, arpegiado en corcheas (arpa o piano eléctrico); en frenesí, rasgueado
  con el patrón pop (1 · 2y · 3 · 4 · 4y) y hi-hats.
- Las velas fuertes agregan la séptima; la posición del precio en el rango del día invierte el acorde.
- El **solista** apoya en el acorde: las notas que caen en tiempo fuerte se ajustan a la nota del
  acorde más cercana, y las débiles pasan por la escala.
- En pantalla aparece la **partitura**: los cuatro acordes con su cifrado romano (mayúsculas mayor,
  minúsculas menor, ° disminuido, ♭/♯ frente a la escala mayor) y su nombre, el acorde actual
  encendido con el color del modo, y un **teclado de piano** de dos octavas con las notas del acorde
  iluminadas y la nota del solista en el color de su sector.

### El visual

Abajo, el SPY es un **horizonte de luz** sobre un mar que respira con los graves. En el cielo, la
acción enfocada es una **aurora** dibujada con su precio, cuya cortina brilla según el volumen de
cada minuto. Arriba, las demás acciones son una **constelación**: cada estrella sube o baja con su
cambio del día y crece con su volumen. Cada nota florece en una partícula, cada acorde en un
anillo, cada latido en un pulso de la nebulosa. La paleta sigue al modo: dorado y violeta en lidio,
azul en jónico, verde agua en dórico, índigo en eólico, carmesí en frigio.

## Controles

- **Portada**: elegí el día y tocá *Escuchar* (el navegador exige un clic para arrancar el audio).
- **Selector de día**: los días grabados, "Un día inventado" (la tecla `N` genera otro) y "El
  mercado ahora, en vivo".
- **Velocidad** ½× · 1× · 2× · 3× (teclas `1`–`4`). **Director** automático o manual (`A`).
- **Estilo** libre o progresión de acordes (`P`).
- **Solista**: clic en una estrella, o `←` `→` para recorrer la constelación.
- **Línea de tiempo** abajo: clic para saltar a otra hora del día.
- `espacio` play/pausa · `H` esconde los paneles (también se esconden solos) · `F` pantalla completa.

## Modo en vivo

En el selector elegí "El mercado ahora, en vivo", elegí el proveedor, pegá tus claves, escribí
hasta 12 acciones y tocá *Conectar*. Las claves se guardan sólo en tu navegador. Fuera del
horario de mercado suenan las últimas velas disponibles; mientras se espera la vela siguiente, la
música varía la última. Si tu navegador bloquea las consultas por CORS, usá los días grabados o
un proxy propio.

- **Alpaca** (recomendado): API key ID y secret de [alpaca.markets](https://alpaca.markets); el
  feed IEX es gratis y SIP necesita el plan pago. Al conectar, una sola consulta de velas de 1
  minuto trae **todo el día para todos los símbolos**, así la música arranca con el contexto
  entero; después se abre el **stream por WebSocket** y cada vela llega empujada apenas cierra
  (tiempo real), con un sondeo cada 20 segundos como respaldo. Alpaca admite una sola conexión de
  stream por cuenta: si otra app (Pulso, por ejemplo) ya la tiene, queda el sondeo.
- **Massive**: API key de [massive.com](https://massive.com). Consulta el snapshot del mercado cada
  20 segundos (una llamada para todos los símbolos, dentro del plan gratis) y arranca desde el
  minuto actual, sin reconstruir la mañana.

## Los días grabados

`data/raw/*.csv` son las velas descargadas de Massive (minuto desde la apertura, apertura,
máximo, mínimo, cierre, volumen en miles). `python3 data/build.py` las empaqueta en
`data/dias.js`. SPY está en velas de 1 minuto; las acciones, de 2 o 3 minutos.

- **Lunes 21 de septiembre de 2026**: subida sostenida del S&P 500 (+0,9 %), META +9 %, MRNA +7 %,
  y dos micro caps en ebullición (VRME +40 %, GRML +30 % con 218 M de acciones).
- **Viernes 30 de octubre de 2026**: caída con volumen (−0,7 %) y rebote en el cierre; AMZN +3,4 %
  a contramano, PLTR −4,9 %, JPM −2,4 %, AIOK que duplica y CLRO que pierde un tercio.

Para agregar un día: bajá las velas con el endpoint `/v2/aggs/ticker/{SYM}/range/1/minute/...`
de Massive (sesión regular), guardalas como `data/raw/<LETRA>_<SYM>.csv`, sumá el día en
`DIAS` dentro de `build.py`, su ficha en `fichas.js` y corré el script.

## Archivos

- `index.html` · `style.css`: la página y la interfaz de vidrio.
- `teoria.js`: modos, escalas, acordes y nombres; generador determinista.
- `fichas.js`: sectores (instrumento, fraseo, color) y fichas de las empresas.
- `sintesis.js`: motor Web Audio (presets, buses, reverb, delay, percusión, analizador).
- `mercado.js`: estadísticas por símbolo y fuentes (replay, sintética, en vivo).
- `partitura.js`: el compositor (orquesta, solista, coro).
- `visual.js`: el lienzo onírico.
- `app.js`: transporte, director, HUD y atajos.

Nada de esto es una recomendación de inversión. Es música.
