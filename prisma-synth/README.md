# Prisma Synth

Sintetizador digital multi‑motor para navegador, inspirado en el flujo de trabajo de Arturia Pigments: dos motores de síntesis por patch, dos filtros, modulación por arrastrar y soltar con código de colores, vista Play con macros circulares y visualizador animado, arpegiador y una cadena de efectos que incluye un **Corroder** (distorsión por FM + grano).

Todo el DSP corre en un `AudioWorklet` escrito en JavaScript puro. No hay dependencias ni paso de build obligatorio.

## Ejecutar

Opción 1 — archivo autónomo (sin servidor): abrí [`dist/prisma-synth.html`](dist/prisma-synth.html) en Chrome, Edge u otro navegador basado en Chromium (Firefox y Safari recientes también soportan AudioWorklet).

Opción 2 — servir la carpeta (recomendado para desarrollo):

```bash
cd prisma-synth
npx http-server . -p 8080 -c-1      # o: python3 -m http.server 8080
# abrir http://localhost:8080
```

Pulsá **⏻ Start** (los navegadores exigen un gesto del usuario para iniciar audio) y tocá con el teclado de la computadora (`A W S E D F T G Y H U J K O L P`, `Z`/`X` cambian de octava), con el teclado en pantalla o con un controlador MIDI (Web MIDI, Chrome/Edge).

## Qué incluye

### Motores de síntesis (2 por patch, A y B, mezclables)

| Motor | Descripción |
|---|---|
| **Analog** | Seno / triángulo / sierra / pulso con PolyBLEP, PWM, hard sync, unison hasta 7 voces con detune y spread estéreo, sub oscilador y ruido. |
| **Wavetable** | 8 tablas × 16 frames (Basic, Harmonics, PWM, Formant, Bell, Digital, Organ, Vox) con mip‑maps por IFFT para evitar aliasing, morph de posición y 4 modos de warp (Bend, Sync, Fold, Mirror), unison. |
| **FM** | 3 operadores, 4 algoritmos, ratios continuos, feedback y plegado de onda del carrier. |
| **Granular** | Hasta 48 granos por voz sobre fuentes internas (Choir, Bell, Piano, Texture) o un sample tuyo: tamaño, densidad, posición, spray, aleatoriedad de pitch, forma de ventana y scan. |
| **Harmonic** | Aditivo de 32 parciales: número de parciales, inclinación espectral, balance par/impar, estiramiento inarmónico, peine espectral y shimmer. |
| **Modal** | Banco de 16 resonadores con morph continuo de material (cuerda → barra → membrana → campana), decaimiento, amortiguación, posición de golpe y tres excitadores. |
| **Sample** | Reproductor con punto de inicio, loop y tono. Arrastrá un archivo de audio sobre el panel del motor (o usá *Load Sample*). |

Cada motor tiene nivel, paneo, octava/semitono/fino y ruteo a Filtro 1, Filtro 2, ambos o bypass.

### Filtros
Dos filtros multimodo (LP 12/24, HP 12/24, BP, Notch, Comb, Formant vocal) con resonancia, drive y key tracking, en paralelo o en serie.

### Modulación
- 3 envolventes ADSR con curva (Env 1 = amplitud), 3 LFOs polifónicos (6 formas, sync a tempo, fase, retrigger, suavizado), 4 macros con nombre editable, velocidad, key track, mod wheel, pitch bend y random por nota.
- **Arrastrá** el chip de una fuente sobre cualquier perilla para crear una modulación, o **hacé click** en el chip para entrar en *modo asignación* y girar perillas para fijar la cantidad (como en Pigments). Click derecho sobre una perilla abre sus modulaciones; la matriz completa está al pie de la vista Synth.
- Los anillos de color alrededor de cada perilla muestran el rango modulado y un punto blanco sigue el valor real en tiempo real.

### Efectos (4 slots en serie)
Corroder, Distortion (soft/hard/fold/crush), Multi Filter con seguidor de envolvente, Chorus, Phaser, Delay (ping‑pong, sync a tempo), Reverb (con shimmer), EQ de 3 bandas y Compressor. Todos los parámetros de efectos son modulables.

### Vistas
- **SYNTH**: motores, filtros, envolventes, LFOs, macros, matriz.
- **FX**: cadena de efectos.
- **ARP**: arpegiador (Up/Down/Up‑Down/Random/Order, divisiones, octavas, gate, swing).
- **PLAY**: nombre del preset, 4 macros grandes, visualizador circular animado y controles rápidos.

### Presets
14 presets de fábrica que cubren todos los motores. *Save* guarda en el navegador (localStorage); *Export/Import* usan JSON.

### MIDI y dispositivos
El botón **MIDI ▾** de la cabecera abre el panel de dispositivos: elegí la entrada MIDI (todas o un teclado concreto; la lista se actualiza al conectar o desconectar) y la salida de audio (Chrome/Edge, vía `setSinkId`). Mensajes soportados: note on/off, pitch bend, CC1 (mod wheel), CC64 (sustain), CC20‑23 (macros 1‑4), CC74 (cutoff F1), CC71 (resonancia F1).

Web MIDI requiere Chrome, Edge u Opera y una pestaña propia (dentro de un iframe el navegador suele bloquearlo).

## Estructura

```
prisma-synth/
├── index.html
├── css/style.css
├── js/
│   ├── shared/params.js        # tabla de parámetros, fuentes de modulación, tipos de FX (UI + worklet)
│   ├── audio/synth-processor.js# todo el DSP (AudioWorkletProcessor, también importable desde Node)
│   ├── audio/engine.js         # AudioContext, mensajes al worklet, Web MIDI
│   ├── ui/knob.js              # perillas con anillos de modulación, drag & drop, selectores
│   ├── ui/visualizer.js        # visualizador maestro, osciloscopios, curvas de envolvente/LFO
│   ├── ui/keyboard.js          # teclado en pantalla y de computadora
│   ├── presets.js
│   └── main.js                 # estado, vistas, matriz, presets, MIDI
├── test/dsp.test.mjs           # prueba de humo del DSP en Node
├── build.mjs                   # genera dist/prisma-synth.html
└── dist/prisma-synth.html      # versión de un solo archivo
```

## Desarrollo

```bash
npm test          # renderiza cada motor, filtro y efecto en Node y verifica niveles / NaN / rendimiento
node build.mjs    # regenera dist/prisma-synth.html
```

La comunicación UI ↔ worklet es por mensajes: parámetros normalizados (0..1) con suavizado por bloque, lista de slots de modulación, notas, bend/modwheel/sustain y samples. El worklet devuelve ~30 veces por segundo los valores de las fuentes de modulación, los osciloscopios de cada motor y el nivel de salida.
