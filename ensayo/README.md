# Ensayo — practicá los temas de tu banda sin tu banda

App web para músicos que tienen que ensayar un repertorio y no tienen a la banda al lado.
Elegís tu instrumento, armás la setlist, cada tema tiene un **backing track sin tu
instrumento** y la app te muestra **la letra y los acordes sincronizados** con la base.

- Guitarrista: base con todo menos la guitarra principal → ves acordes + letra.
- Bajista: todo menos el bajo → acordes + letra. Baterista: todo menos la batería.
- Cantante: karaoke (todo menos la voz) → ves solo la letra.
- Tecladista: todo menos las teclas → acordes + letra.

Corre 100 % en el navegador, sin dependencias ni build (misma filosofía que
[Armonía](../armonia/README.md)). Los datos quedan en el dispositivo (localStorage + IndexedDB).

- **Probarla**: https://agustincorreas.github.io/codex-playground/ensayo/ (se publica desde `main`).
- **Local**: `cd ensayo && python3 -m http.server 8000` y abrir http://localhost:8000
  (necesita servidor por el iframe de YouTube; para archivos locales y metrónomo también sirve
  abrir `index.html` directo).

---

## 1. Qué hace hoy (MVP en este repo)

| Área | Qué hay |
| --- | --- |
| **Onboarding** | Elegís instrumento (guitarra, bajo, batería, voz, teclado, otro) y nivel. Cambia qué base se usa y qué se muestra (voz = solo letra). |
| **Catálogo precargado** | `catalog.js`: ~117 temas (rock argentino, latino, clásicos internacionales y hits actuales) con tonalidad, BPM, **acordes básicos por sección** y **bases de YouTube por instrumento** encontradas por título ("guitar backing track", "bassless", "drumless", "karaoke"…). Se busca por título o artista y se agrega con un toque. Si un tema no está, se agrega igual y la app busca letra y base. |
| **Acordes sobre la letra** | Como en Cifra Club / Ultimate Guitar: el acorde va encima de la sílaba. Si el tema viene del catálogo, los acordes de cada sección se ubican automáticamente sobre la letra sincronizada (aproximado, la app lo avisa). Con **Pegar cifrado** pegás el de Cifra Club o UG tal cual (acordes arriba de la letra, "Intro: Am F C G"…): la app lo convierte a inline y le copia los tiempos de la letra sincronizada línea por línea, así queda exacto y sigue a la base. |
| **Letra automática** | Al agregar un tema, `lyrics.js` pide la letra **sincronizada** a [LRCLIB](https://lrclib.net) (API abierta, sin key) y la convierte al formato del cifrado. Si solo hay letra plana, queda para sincronizar a mano. |
| **Setlist** | Varias setlists, orden con ▲▼, biblioteca, estado por tema (base para tu instrumento, letra sincronizada). Exportar/importar JSON para pasarlo a la banda. |
| **Base por instrumento** | Cada tema guarda una base por instrumento (YouTube, archivo propio o metrónomo) con su desfase. Si falta la de tu instrumento, el panel **"Falta la base"** arma la búsqueda de YouTube según el instrumento, abrís YouTube, copiás el link y lo pegás (o usás metrónomo mientras). Si YouTube no permite reproducir un video embebido, el panel vuelve a aparecer para elegir otro. |
| **Ensayar** | Panel de **acordes por sección** (transpuesto) fijo arriba + letra sincronizada abajo con la línea activa resaltada y auto-scroll. Loop A-B, velocidad sin cambiar el tono, transposición y capo (de la pantalla), **desfase** ±0,5 s entre letra y base, count-in, tamaño de letra, acordes/letra on-off, anterior/siguiente de la setlist, atajos de teclado. En el celu todos los controles están en filas deslizables. |
| **Sincronizar** | Para letras sin tiempos o para ajustar: dale play y marcá cada línea con un botón (o Enter). Deshacer, correr todo ±0,25 s, borrar. Queda guardado en el cifrado. |
| **Grabar** | Audio (mic sin cancelación de eco ni AGC) o cámara + mic con MediaRecorder. Cada toma guarda desde qué punto de la base se grabó; en "Tomas" la escuchás, la bajás o la reproducís junto con la base desde ese punto. |
| **Editar a mano** | Título, artista, tono, BPM, compás, notas, acordes por sección, base por instrumento, y el cifrado completo en ChordPro con timestamps `[m:ss.xx]`. Botón para convertir "acordes arriba de la letra" (Ultimate Guitar / LaCuerda). |

Atajos en Ensayar: `espacio` play/pausa · `←/→` ±5 s · `[` `]` loop A/B · `L` quitar loop ·
`+/-` transponer · `Enter` marcar línea (en Sincronizar).

Archivos: `index.html`, `style.css`, `chart.js` (parser ChordPro + LRC, transposición, conversión
acordes-arriba), `player.js` (adaptadores YouTube / archivo local / metrónomo con interfaz común),
`lyrics.js` (LRCLIB), `catalog.js` (catálogo generado), `store.js` (localStorage + IndexedDB),
`recorder.js` (MediaRecorder), `app.js` (vistas y transporte).

Sobre el catálogo: las bases son videos públicos de YouTube elegidos por su título; pueden estar en
otro tono o con otra intro que la letra (para eso está el **desfase** y la transposición de
pantalla), y algún video puede no permitir reproducción embebida (la app avisa y ofrece buscar
otro). Los acordes marcados "aprox." salieron de fuentes poco claras: corregilos desde Editar.
Las letras vienen de LRCLIB, una base comunitaria: si no aparece, se puede pegar a mano.

---

## 2. Investigación: qué existe, qué les falta

Relevamiento hecho en septiembre de 2026 (precios en USD, cambian por región).

### Los que más se acercan

| App | Qué hace | Precio | Lo que le falta para esto |
| --- | --- | --- | --- |
| **Moises** (moises.ai) | Separación de stems con IA (voz, batería, bajo, guitarra, teclas), acordes y tonalidad detectados, tempo/pitch, "Chord Grid" (acordes + letra por compás), setlists compartidas con la banda, grabación de video sobre la mezcla. | Free (5 separaciones/mes) · Premium ~4 · Pro ~10/mes | **No acepta links de YouTube** (política explícita); hay que subir el archivo. Sin tabs/riffs. Letra transcripta por IA, con errores. Pensado "un tema a la vez", no "ensayo de banda por instrumento". |
| **Chordify** | Pegás un link de YouTube y genera acordes sincronizados; **reproduce el video embebido** (no descarga). Letra licenciada (LyricFind) en parte del catálogo. Transponer, capo, tempo, loop, setlists. | Free · Basic ~2 · Premium ~3,5 · +Toolkit ~9/mes | **No quita tu instrumento** (suena el tema completo). Sin tabs, sin grabación. |
| **Chord ai** | Acepta YouTube, archivos o micrófono; stems, 300+ tipos de acordes con diagramas, letra karaoke sincronizada, pitch/tempo. | Free · Pro ~9/mes o 69/año | Sin setlists, sin grabación, sin tabs. El competidor más directo "por canción". |
| **Ultimate Guitar Pro** | 29k "Official Tabs" con backing track regrabado, letra sincronizada, multipista con mute de tu parte (guitarra/bajo/batería), loop, tempo, transposición. | ~40/año | Sin YouTube; backing solo en el subset oficial; sin grabación; playlists ≠ setlist de ensayo. |
| **Songsterr Plus** | 1M+ tabs sincronizadas con el audio original; en temas populares, **"Backing Tracks": el original con tu parte muteada**. | ~10/mes | Sin letra, sin acordes simplificados, sin setlist, sin grabación, sin voz/teclas. |
| **Karaoke Version / Jamzone** (Recisio) | 74k backing tracks regrabados por sesionistas, hasta 15 pistas por tema, muteás cualquier instrumento, pitch ±4, tempo. Jamzone: mixer + **acordes y letra sincronizados** + setlists. | KV: ~2–4 por tema · Jamzone Free/Premium/Pro | Son regrabaciones (buenas, no el original), sin YouTube, sin tabs, sin grabación, catálogo anglo. **Jamzone es el benchmark de UX** "elegí tu instrumento y muteálo con letra + acordes". |
| **Soundslice** | Partitura/tab sincronizada con YouTube (gratis) o audio subido; loop por compases; desde 2025 graba audio/video. | Free · Plus 5/mes | No quita instrumentos, no genera acordes/letra; orientado a notación. |
| **Yousician** | Aprendizaje gamificado con feedback por micrófono; house band y (Premium+) originales. | 20–30/mes | Sin batería, sin YouTube, sin setlist, caro, es curso no ensayo. |
| **iReal Pro** | Charts + bases generadas por estilo (jazz con batería real), playlists de gigs, transposición instantánea. | 20 único | No son canciones reales ni tienen letra. |
| **BandHelper / Set List Maker / OnSong** | Gestión de setlists, letra/acordes con auto-scroll, disparo de backing tracks, sync en vivo con la banda. | 4–8/mes | No quitan instrumentos ni sincronizan acordes al audio; reproducen tus archivos. |
| **PracticeSession**, **audio2guitar**, **LALAL.AI / LANDR** | Stems locales o en la nube, audio→tabs+acordes+letra, APIs de separación. | 8–39 | Herramientas de un solo paso, sin flujo de ensayo. |

### Los huecos del mercado (donde entra Ensayo)

1. **Nadie une "link de YouTube → base sin mi instrumento → letra + acordes + riffs sincronizados"**. Chordify tiene YouTube pero no stems; Moises tiene stems pero prohíbe YouTube; Chord ai acerca las dos cosas pero sin setlists, grabación ni tabs.
2. **El ensayo de banda como unidad.** Todos piensan "una canción para una persona". Falta la setlist compartida donde cada integrante elige su instrumento y el mismo tema se sirve con *su* parte muteada, con tonalidad y tempo acordados por la banda.
3. **Batería y teclas están subatendidos.** Yousician no tiene batería; Chordify solo muestra diagramas de guitarra/piano/uke.
4. **Grabarse y comparar.** Solo Moises y Soundslice graban; ninguno permite grabar tu take, mezclarlo con la base y mandárselo a la banda antes del ensayo.
5. **Precio fragmentado.** Cubrir el flujo hoy exige Chordify + Moises + UG + BandHelper (~25–30/mes). Un bundle a 8–10/mes es atractivo.

### Qué copiar de cada uno

- Chordify: el flujo "pegar link → listo en segundos" y la vista acordes-sobre-letra.
- Jamzone / Moises: elegir instrumento → muteado, Chord Grid por compás, setlists colaborativas.
- Songsterr / UG: tab ↔ audio real sincronizado, "tu parte muteada".
- Soundslice: loop arrastrando sobre compases, historial de práctica.
- iReal Pro / BandHelper: playlists de gig, transposición de todo el chart, pedal Bluetooth para pasar.
- Yousician: feedback de afinación/timing en tiempo real (más adelante).

### Ideas que van más allá de lo pedido

1. **Modo banda multi-dispositivo**: todos entran a la misma setlist desde su celular, cada uno con su instrumento; play/pausa/loop sincronizados.
2. **"Silenciar solo cuando toco"**: si dejás de tocar, vuelve el stem original para guiarte (ducking por detección del instrumento).
3. **Riffs y partes por instrumento generados por IA** (transcripción tipo audio2guitar), editables y corregibles por la comunidad: tab de bajo, chart de batería, voicings de teclas.
4. **Cues vocales y marcadores automáticos** ("verso 2 en 4…"), secciones detectadas (intro/verso/estribillo/puente/solo) para loops de un toque.
5. **Grabación multipista de la banda a distancia**: cada uno graba su parte sobre la misma base; la app las alinea y produce la "mezcla de ensayo" y un video en split-screen.
6. **Feedback de precisión** y heatmap de qué secciones fallás más, para priorizar loops.
7. **Setlist con curva de energía**: duración total, tonalidad por tema, choques de tono/tempo entre temas consecutivos, sugerencia de orden.
8. **Presets de sonido por tema** (Tonebridge/AmpliTube o propios) que se cargan al elegir la canción.
9. **Modo escenario**: pantalla grande, pedal Bluetooth/MIDI para avanzar, alto contraste, export ChordPro a BandHelper/OnSong.
10. **Versiones de la banda**: guardar el arreglo propio (tono, cortes, repeticiones) como fork del tema y compartirlo con otras bandas de covers.

---

## 3. Cómo se combina YouTube con letra, acordes y riffs

La pieza central es un **reloj maestro** que alimenta el cifrado:

```
fuente de audio ──► tiempo actual (s) ──► línea activa del cifrado ──► resaltado + auto-scroll
                                       ├─► loop A-B (seek al llegar a B)
                                       └─► secciones (saltar a "Estribillo")
```

- **Cifrado**: ChordPro con un timestamp `[m:ss.xx]` por línea. Es texto plano, se pega desde
  cualquier lado, se transpone en el cliente y se sincroniza una sola vez con el botón "Marcar
  línea" (o, más adelante, automáticamente; ver §5). Los riffs de intro van como tablatura
  (`{sot}…{eot}`) dentro de la sección, con su tiempo.
- **YouTube** se reproduce con el **IFrame Player API oficial**. El player reporta el tiempo cada
  ~250 ms; la app lo interpola con `performance.now()` para que el resaltado sea fluido.
  `seekTo` da el loop A-B; `setPlaybackRate` da 0,25–2× **manteniendo el tono**.
- **Archivo local** (`<audio>` + Web Audio): mismo reloj, control total y latencia baja.
- **Metrónomo** (Web Audio): para temas cuyo cifrado está sincronizado por BPM, o para practicar
  sin base.
- La **base por instrumento** vive en el tema: `tracks.guitarra`, `tracks.bateria`… cada una con su
  link y su desfase respecto al cifrado (dos backings del mismo tema suelen arrancar en momentos
  distintos).

---

## 4. Límites técnicos y legales que definen el producto

Esto es lo que salió de la investigación y **cambia decisiones de diseño**:

| Tema | Qué se puede | Qué no |
| --- | --- | --- |
| **Ocultar el video de YouTube** | Player visible de al menos **200×200 px**, sin nada superpuesto, en la misma pantalla que el cifrado. Así está hecho: video chico en el dock y la letra al lado. | Iframe oculto, de 1 px, tapado por la letra o "solo audio": violan las *Required Minimum Functionality* y las *Developer Policies* de YouTube (riesgo de perder la API key). Tampoco reproducir en background con pantalla apagada. |
| **Publicidad** | — | No se pueden sacar los pre-roll de videos monetizados. |
| **Velocidad** | 0,25× a 2× en pasos fijos, con tono preservado. | Pasos finos (0,9×). |
| **Cambiar la tonalidad del audio** | Se transpone **el cifrado** (lo que hace la app). Si encontrás el backing en otro tono, cargás ese link y transponés la pantalla para que coincida. | Pitch-shift del audio de YouTube: el audio vive en un iframe cross-origin y Web Audio no puede tocarlo. **Sí** se puede con archivos locales (ver §5). |
| **Buscar en YouTube** | Data API v3: 10.000 unidades/día por proyecto y cada búsqueda cuesta 100 → ~100 búsquedas/día por key. Por eso la app abre YouTube y pegás el link, y la búsqueda interna es opcional con tu key. | Un buscador interno masivo sin cachear resultados. |
| **Descargar el audio (yt-dlp)** | — | Viola los términos de YouTube y las políticas de desarrolladores; es lo que hace que Moises rechace links de YouTube. |
| **Separar stems del audio del usuario** | Para uso privado del propio usuario, con Demucs (open source) o APIs (Music AI ~0,10/min, LALAL.AI ~0,15/stem/min). | Almacenar o redistribuir stems/originales de temas con copyright. |
| **Letras** | LRCLIB (API gratis, letras sincronizadas subidas por la comunidad, sin licencia editorial), Musixmatch (sincronizadas y licenciadas, con contrato comercial), o lo que pega el usuario. | Mostrar letras comerciales licenciadas sin contrato, scrapear Ultimate Guitar. |
| **Grabación** | Mic y cámara con MediaRecorder. Con archivo local, la base se puede mezclar en la grabación. | Mezclar el audio de YouTube en la grabación (solo lo capta el mic por los parlantes). |

Conclusión de producto: **dos modos con el mismo núcleo**.

- **Modo YouTube**: descubrimiento y práctica ligera. Player visible + cifrado sincronizado + loop +
  velocidad + transposición del chart. Cero costo de contenido, catálogo infinito de backings.
- **Modo "mi audio"**: la experiencia completa. Archivo propio (comprado en Karaoke Version, stems
  hechos con Moises/Demucs, grabación de la propia banda): transposición real del audio, tempo fino,
  loop exacto, grabación mezclada, detección automática de acordes y beats.

---

## 5. Arquitectura propuesta para la versión producto

**Fase 1 (esto, ya funciona)** — PWA sin backend. Todo local. Sirve para validar el flujo con la
banda: ¿la gente sincroniza los cifrados? ¿usa loop y velocidad? ¿graba?

**Fase 2 — cuenta y banda compartida (Firebase, que ya usás en Sillage)**

- Auth (Google/Apple), Firestore: `bands/{id}/setlists`, `songs` (cifrado ChordPro + tiempos +
  bases por instrumento), `takes` (metadatos). Storage: archivos propios y grabaciones, reglas
  "solo el dueño / solo la banda".
- Cloud Function proxy a YouTube Data API con cache por consulta normalizada (1 búsqueda sirve a
  toda la banda) y lista curada de canales de backing tracks (Karaoke Version, Guitar Backing
  Tracks, drumless channels).
- Realtime: play/pausa/posición compartidos para el "modo banda".

**Fase 3 — el audio se vuelve inteligente (solo para archivos del usuario)**

- **Pitch/tempo en el navegador**: `signalsmith-stretch` (WASM + AudioWorklet, MIT, muy buena
  calidad) o SoundTouchJS. Rubber Band es mejor pero GPL/licencia comercial.
- **Stems**: Cloud Run con GPU corriendo Demucs (htdemucs) o Music AI como API; el resultado se
  procesa y se descarta o queda cifrado en el Storage del usuario.
- **Acordes y beats automáticos**: madmom (CNN + CRF para acordes, DBN para downbeats), Essentia o
  Music AI. Con eso el cifrado se **sincroniza solo**: los tiempos de cada línea se alinean con los
  compases detectados. Tonalidad con Essentia `KeyExtractor` para avisar "este backing está en G,
  tu cifrado está en A: ¿transponemos la pantalla?".
- **Alineación de letra**: WhisperX o NUS AutoLyrixAlign sobre la pista vocal separada.

**Fase 4 — apps nativas**: Expo con `react-native-youtube-iframe` + `expo-audio`, reutilizando el
núcleo web (cifrado, sync, transposición) en un WebView o portado a TypeScript. iOS corta el audio
en background, pero como el player debe estar visible eso no cambia el producto.

**Modelo de negocio sugerido**: gratis con YouTube + cifrados + setlist (adquisición); Pro 8–10/mes
con stems/tono/tempo fino, grabación mezclada, banda compartida y sincronización automática;
marketplace de setlists/arreglos por género más adelante.

---

## 6. Roadmap corto (siguientes pasos concretos)

1. **Probarlo con tu banda**: cargar los 10 temas, buscar un backing por instrumento, sincronizar
   cada cifrado una vez, exportar el JSON y compartirlo. Ver qué duele.
2. Vista "grilla de acordes por compás" (tipo Moises/Jamzone) además de la letra, útil para
   batería y bajo.
3. Loop por sección con un toque (ya hay secciones con tiempo; falta "loop del estribillo").
4. Importar LRC de LRCLIB y unirlo al cifrado para no marcar la letra a mano.
5. Pitch-shift real para archivos locales con `signalsmith-stretch`.
6. Firebase + banda compartida.
