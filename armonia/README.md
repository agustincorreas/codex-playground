# Armonía — chord generating synthesizer

Instrumento web inspirado en el **Orchid** de Telepathic Instruments: un sintetizador
generador de acordes donde elegís la fundamental en un teclado de una octava y el
tipo de acorde con botones, en vez de tocar todas las notas. Corre 100 % en el
navegador con Web Audio, sin dependencias ni build.

- `index.html` + `style.css` + `theory.js` + `audio.js` + `app.js`: código fuente.
- `armonia.html`: **todo en un solo archivo**, para abrir con doble clic (regenerar con `python3 build.py`).
- `armonia-movil.html`: la misma app con el **layout para celulares** forzado (teclado y botones de acorde fijos abajo, controles desplazables arriba). `armonia.html` también cambia solo a ese layout en pantallas angostas.

Apretá **?** (o F1) para el **modo ayuda**: cada control se resalta y al tocarlo se explica qué hace y cómo se relaciona con el resto.

## El panel

| Control | Qué hace |
| --- | --- |
| **Teclado (C–C)** | Cada tecla es la fundamental del acorde. Se puede deslizar entre teclas. |
| **Chord Type** (fila superior) | Major · Minor · Sus · Dim. Uno a la vez. |
| **Chord Modifiers** (fila inferior) | 6 · m7 · M7 · 9. Se combinan libremente (Cmaj9, Dm7, G13, Bø7, C6/9…). |
| **Voicing Dial** | Gira nota a nota: cada paso sube la nota más grave una octava (o baja la más aguda), en cascada de inversiones. Con el acorde sonando, las notas que se mueven se re-disparan: un arpegio dinámico. |
| **Octave** | Desplaza el registro ±2 octavas. |
| **Sound** | 20 presets: Keys · E-Piano (FM) · Wurli · Organ · Pad · Strings · Choir (formantes) · Pluck · Guitar · Brass · Bells (FM) · Marimba · Clav · Harp · Vibes · Flute · Poly 80 · Kalimba · Glass · Dream. Cada preset define su chorus estéreo, vibrato, trémolo, transitorio y panorama por voz; la velocidad MIDI controla el brillo. Cambiar Sound afecta lo que tocás y la capa que estás grabando; las capas anteriores del loop conservan el suyo. |
| **Perform** | Chord · Strum · Strum 2 Oct · Slop (timing humano) · Arpeggiate · Arp 2 Oct · Pattern A/B/C · Harp (cascada de 3 octavas). |
| **FX** | Dry · Room · Hall · Echo · Tape · Chorus · Lo-fi, con perilla de cantidad. |
| **Key** | Transpone el teclado (la tecla de la izquierda pasa a ser la tónica elegida). El botón **Key mode** debajo cicla Off → Major → Minor: en Major/Minor cualquier tecla genera el acorde diatónico de esa tonalidad y los botones de tipo pasan a ser automáticos (se ven en amarillo). Ese "Minor" es la tonalidad completa; el botón Minor de los tipos es un acorde suelto y en Key mode no se usa. |
| **Bass** | Nivel del bajo. El botón cicla **Off → On → Solo**. En On el bajo sigue la fundamental (con groove cuando hay beat); en **Solo** el teclado toca el bajo monofónico mientras el acorde latcheado o en loop sigue sonando: para pasear la línea de bajo. |
| **Loop** | Looper de 1 · 2 · 4 · 8 compases. Rec arma; el loop arranca **exacto** con la primera nota (cuantizada al grid) y, si el beat no estaba sonando, el beat arranca alineado con ese punto. Al completar los compases pasa solo a reproducirse en bucle. Rec de nuevo abre una capa de Overdub sin tocar el loop original. **Cada capa es una pista independiente** que recuerda su Sound, su Perform y su bajo, y suena superpuesta a las demás: grabá un pad, cambiá a Pluck con arpegio y grabá encima. **Undo** quita la última capa y Clr borra todo. La barra de la pantalla muestra compases, posición, y el color del estado (rojo grabando, amarillo overdub, blanco reproduciendo). |
| **BPM** | Tempo. Debajo, el selector de **beats**: batería sintetizada con hi-hats metálicos, redoblante con bordona, bombo con clic, palmas, aro, shaker y toms, acentos y ghost notes, compresión y un toque de reverb: Hip hop · Boom bap · Lo-fi · Neo soul · Disco · House · Techno · Bossa nova · Reggaetón · Breakbeat · Electronic · Trap · Funk. Play arranca beat y loop. |
| **Options** | **Quantize** (los cambios de acorde caen en la semicorchea siguiente cuando hay beat, loop, arpegio o patrón, así nada queda cortado; la pantalla muestra "→ acorde" mientras espera) · Latch (mantener el acorde) · Arp 1/16 · Swing (0/25/50) · Metrónomo. |
| **Volume** | Master. |

La pantalla muestra el nombre del acorde, sus notas, y el estado de cada sección.

## Atajos de teclado

- `A W S E D F T G Y H U J K` teclas C…C · `1–4` tipo · `5–8` modificadores
- `← →` voicing · `↑ ↓` octava · `espacio` play · `B` bajo on/off

## MIDI

Web MIDI funciona en **Chrome y Edge**; aceptá el permiso cuando el navegador lo pida
(el indicador de la cabecera queda verde con dispositivos detectados y parpadea con cada mensaje).

- **MIDI IN**: las teclas del controlador son las mismas que las de la pantalla (el Do del teclado es la primera tecla, en cualquier octava; Key transpone a ambas), con velocidad ·
  rueda de modulación → voicing · pedal de sustain → latch · CC7 → volumen · pitch-bend.
- **MIDI OUT**: acorde → canal 1, bajo → canal 2.

## Cómo ejecutarlo fuera de Claude

1. **En la PC**: descargá `armonia.html` y abrilo con doble clic (Chrome o Edge para MIDI). No necesita servidor.
2. **Desde el código fuente**: cloná el repo y abrí `armonia/index.html`, o servilo con
   `python3 -m http.server 8000` dentro de `armonia/` y entrá a `http://localhost:8000`.
   Después de editar los fuentes, `python3 build.py` regenera los archivos de un solo archivo.
3. **Como web pública (ideal para el celular)**: el workflow `.github/workflows/pages.yml`
   publica la carpeta `armonia/` en GitHub Pages cada vez que se actualiza `main`.
   Queda en `https://agustincorreas.github.io/codex-playground/` (y `/armonia-movil.html`
   para forzar el layout de teléfono). La primera vez, en GitHub → Settings → Pages,
   verificá que la fuente sea "GitHub Actions".
