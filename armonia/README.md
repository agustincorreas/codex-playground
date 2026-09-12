# Armonía — generador de armonías semi-modular

Instrumento web inspirado en [Nopia](https://nopia.io/): un **generador de acordes
basado en armonía tonal** donde cada tecla no es una nota sino un **grado** de la
tonalidad. Corre 100 % en el navegador con Web Audio, sin dependencias ni build.

Abrí `index.html` (o serví la carpeta con cualquier servidor estático) y presioná
**Encender** o simplemente tocá una tecla.

## Cómo está organizado el panel

| Módulo | Qué hace |
| --- | --- |
| **Display (OLED)** | Nombre del acorde, grado romano, función armónica, notas, mini piano y osciloscopio. |
| **Tonal selector** | 12 botones en forma de teclado eligen la tónica. Switch **mayor / menor**. Switch **función**: diatónico · dominantes (cada tecla se vuelve un 7ª de dominante → dominantes secundarias) · disminuidos (de paso). |
| **Chord builder** | Teclado de una octava. Teclas blancas = grados I–VII; negras = acordes cromáticos (intercambio modal, napolitano, sensibles). |
| **Voicing** | Dial de **extensiones** (tríada · 7 · 9 · 11 · 13), **inversión**, **octava**, tipo de voicing (cerrado · drop 2 · abierto · amplio), **sus** y **hold**. |
| **Strum · pitch** | Superficie de strum para tocar las notas del acorde una a una y tira de pitch-bend (±2 semitonos, cromático o continuo). |
| **Clock · looper** | Tempo, play, metrónomo y looper de eventos (1–8 compases, rec → play → overdub). |
| **Keys / Bass / Arp / Pad** | Cuatro módulos de sonido (analógico virtual). Bass con pads **root / alt** y modos por reloj; Arp con modos, rate sincronizado, octavas y gate; Pad con swell y detune. |
| **Master FX** | Drive, filtro resonante, delay sincronizado, reverb, master. |
| **Mod (patch bay)** | Fuentes LFO · ENV · CLOCK · STRUM · RAND. Hacé clic en una fuente y luego en un jack de destino (cutoff, pitch, trémolo, tiempo/mix del delay, mix de reverb, detune del pad, pan). Cada destino tiene su mini-perilla de cantidad; clic en un cable lo quita. Viene pre-parcheado ENV→cutoff y LFO→pad detune. |

## Atajos de teclado

- `A S D F G H J` grados I–VII · `W E T Y U` teclas negras
- `Z` / `X` bajo root / alt · `1–5` extensiones · `↑ ↓` octava · `espacio` play

## MIDI

Si el navegador soporta Web MIDI (Chrome/Edge), elegí una salida en **MIDI OUT**:
Keys → canal 1, Bass → canal 2, Arp → canal 3, Pad → canal 4, más pitch-bend.

## Archivos

- `theory.js` — motor de armonía (grados, extensiones, voicings, nombres, funciones)
- `audio.js` — motor de sonido, FX, fuentes de modulación y reloj
- `app.js` — interfaz, patch bay, looper, MIDI
- `style.css` — estética pastel / minimal del panel
