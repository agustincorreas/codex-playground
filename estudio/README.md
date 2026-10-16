# Estudio — grabá música por capas (estilo GarageBand, en el navegador)

App web táctil para hacer música por capas, pensada para **iPhone / iPad / Android** y
escritorio. Está inspirada en el *género* de los estudios móviles tipo GarageBand, pero es
**código original**: no clona ni reutiliza nada de GarageBand ni de ninguna app propietaria.

Sin dependencias ni build: abrí `index.html` desde un servidor local o en
https://agustincorreas.github.io/codex-playground/estudio/.

## Qué hace

- **Pistas de instrumento de software**: Piano, E-Piano/Synth, Bajo, Pad. Teclado táctil de dos
  octavas con botones de octava.
- **Pista de batería**: pads (kick, snare, hi-hat, open hat, clap, tom) sintetizados.
- **Pista de micrófono**: graba una pasada del loop desde el micrófono (`getUserMedia` +
  `MediaRecorder`) y la reproduce en bucle.
- **Grabación por capas (overdub)**: con el loop girando, apretás ● y lo que toques se graba
  encima de la pista seleccionada, pasada tras pasada. Igual que armar un beat en capas.
- **Transporte**: play/stop, loop de 1/2/4/8 compases, tempo 40–240 BPM, metrónomo con acento
  en el primer tiempo y count-in natural (el click marca antes de grabar).
- **Ajuste al ritmo (cuantización)** opcional a semicorcheas.
- **Mezcla por pista**: mute, solo y volumen. Playhead animado y mini-vista de cada pista.

## Cómo está hecho

- `index.html` — estructura (transporte, línea de tiempo, zona de interpretación).
- `style.css` — tema oscuro de estudio, mobile-first, táctil.
- `engine.js` — `AudioEngine`: `AudioContext`, transporte con scheduler de *lookahead*,
  metrónomo, sintetizador polifónico ADSR, batería sintetizada y pistas de audio.
- `app.js` — UI: pistas, teclado, pads, grabación overdub, micrófono, playhead.

El scheduler agenda cada pasada del loop por adelantado con `AudioContext.currentTime`, que es la
forma correcta de temporizar audio en la web (ver *"A Tale of Two Clocks"*, Chris Wilson). El
`AudioContext` se crea con el primer toque, requisito de iOS Safari.

## Probarlo

1. Abrí la app (en el iPhone/iPad conviene agregarla a la pantalla de inicio: se ve a pantalla
   completa).
2. Tocá **▶**: empieza a girar el loop con el metrónomo.
3. Elegí la pista **Batería**, apretá **●** y tocá los pads: se graba en capas.
4. Agregá una pista **Piano** y grabá una melodía encima.
5. Ajustá tempo, mute/solo y volumen para mezclar.

## Límites conocidos (v1)

- El micrófono necesita HTTPS (o `localhost`) y permiso del navegador. En algunos navegadores
  dentro de un iframe puede estar bloqueado por *permissions policy*.
- Las tomas de micrófono se alinean al límite del loop de forma aproximada; no hay edición de
  audio todavía.
- No hay guardado/exportación todavía (ver roadmap).
- Los timbres son sintetizados (no hay muestras de instrumentos reales).

## Roadmap

- Guardar/cargar proyectos (localStorage) y exportar la mezcla a WAV.
- Editar notas en el carril (mover/borrar), borrar última toma grabada.
- Más instrumentos y efectos (reverb, delay, filtro).
- Patrones de batería prearmados y Live Loops por celdas.
- Compartir proyecto por enlace.

## Legales

Proyecto original con fines educativos y de experimentación. "GarageBand" es marca de Apple Inc.;
se la menciona solo como referencia del tipo de app. Este código no deriva de ella.
