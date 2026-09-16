# Armonía — chord generating synthesizer

Instrumento web inspirado en el **Orchid** de Telepathic Instruments: un sintetizador
generador de acordes donde elegís la fundamental en un teclado de una octava y el
tipo de acorde con botones, en vez de tocar todas las notas. Corre 100 % en el
navegador con Web Audio, sin dependencias ni build.

- `index.html` + `style.css` + `theory.js` + `audio.js` + `app.js`: código fuente.
- `armonia.html`: **todo en un solo archivo**, para abrir con doble clic (regenerar con `python3 build.py`).

## El panel

| Control | Qué hace |
| --- | --- |
| **Teclado (C–C)** | Cada tecla es la fundamental del acorde. Se puede deslizar entre teclas. |
| **Chord Type** (fila superior) | Major · Minor · Sus · Dim. Uno a la vez. |
| **Chord Modifiers** (fila inferior) | 6 · m7 · M7 · 9. Se combinan libremente (Cmaj9, Dm7, G13, Bø7, C6/9…). |
| **Voicing Dial** | Gira nota a nota: cada paso sube la nota más grave una octava (o baja la más aguda), en cascada de inversiones. Con el acorde sonando, las notas que se mueven se re-disparan: un arpegio dinámico. |
| **Octave** | Desplaza el registro ±2 octavas. |
| **Sound** | Keys · E-Piano · Organ · Pad · Strings · Pluck · Brass · Bells. |
| **Perform** | Chord · Strum · Strum 2 Oct · Slop (timing humano) · Arpeggiate · Arp 2 Oct · Pattern A/B/C · Harp (cascada de 3 octavas). |
| **FX** | Dry · Room · Hall · Echo · Tape · Chorus · Lo-fi, con perilla de cantidad. |
| **Key** | Transpone el teclado (la tecla de la izquierda pasa a ser la tónica elegida). |
| **Bass** | Nivel del bajo. El botón cicla **Off → On → Solo**. En On el bajo sigue la fundamental (con groove cuando hay beat); en **Solo** el teclado toca el bajo monofónico mientras el acorde latcheado o en loop sigue sonando: para pasear la línea de bajo. |
| **Loop** | Looper de 1 · 2 · 4 · 8 compases: Rec (se arma y empieza con la primera nota) → Play → Overdub. Cada pasada de overdub es una capa nueva sin tocar el loop original; **Undo** quita la última capa grabada y Clr borra todo. La pantalla muestra la cantidad de capas. |
| **BPM** | Tempo. Debajo, el selector de **beats** de batería sintetizada: Hip hop · Boom bap · Lo-fi · Disco · House · Bossa nova · Electronic · Trap · Funk. Play arranca beat y loop. |
| **Options** | **Key mode** (cualquier tecla genera el acorde diatónico de la tonalidad elegida con Key; las notas fuera de la escala se ajustan y los botones de tipo muestran el resultado; 6 · 7 · 9 agregan la extensión que corresponde a la tonalidad) · **Minor key** · Latch (mantener el acorde) · Arp 1/16 · Swing (0/25/50) · Metrónomo. Girá el encoder para elegir, clic para conmutar. |
| **Volume** | Master. |

La pantalla muestra el nombre del acorde, sus notas, y el estado de cada sección.

## Atajos de teclado

- `A W S E D F T G Y H U J K` teclas C…C · `1–4` tipo · `5–8` modificadores
- `← →` voicing · `↑ ↓` octava · `espacio` play · `B` bajo on/off

## MIDI

Web MIDI funciona en **Chrome y Edge**; aceptá el permiso cuando el navegador lo pida
(el indicador de la cabecera queda verde con dispositivos detectados y parpadea con cada mensaje).

- **MIDI IN**: cualquier nota = fundamental (en cualquier octava), con velocidad ·
  rueda de modulación → voicing · pedal de sustain → latch · CC7 → volumen · pitch-bend.
- **MIDI OUT**: acorde → canal 1, bajo → canal 2.
