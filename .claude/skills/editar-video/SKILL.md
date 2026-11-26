---
name: editar-video
description: Edita un video crudo vertical de Agus (reseña, top, novedad, evento) con el estilo de su cuenta, usando el pipeline de editor-video/. Usar cuando pase un link de Google Drive a una carpeta con un crudo, o pida "editame este video".
---

# Editar un video crudo con el estilo de la cuenta

Entrada: un link a una carpeta de Google Drive con el crudo (un `.mov` vertical 1080×1920), o un archivo adjunto.
Salida: `editado.mov` (H.264 + AAC, mismo nombre que usa Meli, su editora) y un resumen breve de lo que se cortó.

Trabajar con el pipeline de `editor-video/` (leer su `README.md` primero). Correr `editor-video/setup.sh <carpeta>` con una
carpeta de trabajo fuera del repositorio (scratchpad) y exportar `VIDEO_EDIT_ROOT`: deja dependencias, modelos,
tipografías y efectos listos.

## Dónde está el pipeline
Los scripts viven en la carpeta `editor-video/` del repositorio `agustincorreas/codex-playground`. Si la sesión no está
abierta sobre ese repositorio, usar `~/Documents/codex-playground` (clonarlo de `https://github.com/agustincorreas/codex-playground.git`
si no existe, y hacer `git pull` si existe) y trabajar con `~/Documents/codex-playground/editor-video`. No pedirle al
dueño que lo haga: resolverlo solo.

## Reglas del dueño (no negociables)
- Cortar silencios **sin cortar palabras**. Sacar muletillas, repeticiones y frases redundantes o prescindibles.
- Duración: en general **hasta 1:30**; solo si el video lo amerita puede pasar, y **nunca más de 3:00**.
- Estilo elegante, moderno y minimalista. No sobre-editar, pero con ritmo.
- **Sin música.** Efectos de sonido solo los sintetizados por `work/sfx.py`, al menos 8 dB bajo la voz.
- Imágenes: Fragrantica (botellas, notas, puntaje) y stock con licencia libre. No saltear bloqueos anti-bots.
- Entender de qué perfume o tema se habla antes de editar; verificar cada dato que aparezca en pantalla.
- Resolver solo; preguntar únicamente si es imprescindible. Avisar al terminar.
- **Notas**: cada ingrediente que nombra aparece como medallón (`medal`), no solo algunos. Las imágenes de notas
  salen de `https://fimgs.net/mdimg/sastojci/o.<id>.jpg` (lavanda = 1, vainilla = 74, coco = 138, ananá = 170…).
- **Marca**: cuando dice la marca, mostrar su logo (`brand_badge` con `logo=`). Si no hay archivo del logo, va el
  nombre como placa y se le pide el PNG al dueño.
- **Sin frase de cierre**: nada de placas tipo "Perfumazo." al final; queda publicitario. El video termina en su
  última palabra (no usar `end_plate`).
- **Otros perfumes que nombra**: el frasco recortado sin fondo pasa rápido por detrás de él (`flyby`, menos de 1 s),
  nunca fijo en pantalla ni con su nombre, para no dar protagonismo a otras marcas.
- **Listas con checks**: un clic por cada ítem que se enciende (ya lo hacen `check_list` y `pros_cons`).

## Pasos
1. **Bajar el crudo** (`https://drive.usercontent.google.com/download?id=ID&export=download&confirm=t`) a `dl/src/raw.mov`.
   Si la red lo bloquea, usar el entorno `codex-playground-video` o pedir los hosts de Drive, fimgs.net, Mixkit,
   Wikimedia y Hugging Face.
2. **Preparar**: wav a 16 k y 48 k (`audio/src_16k.wav`, `audio/src_48k.wav`). Revisar si el crudo está espejado (texto de la botella al revés) → `hflip`.
3. **Transcribir y alinear**: `transcribe.py` → corregir a mano una transcripción literal en `work/src_transcript.txt`
   (formato `mostrado|pronunciado`) → `falign.py` → `vad.py`.
4. **Decidir cortes** (`build/edl/cfg_*.json` + `edl.py`):
   - pausas: frase 0,24 s, cláusula 0,17 s, interna 0,12 s; no cortar si se quita menos de 0,24 s;
   - contenido: solo por unidades con silencio real a ambos lados (`cand_check.py`); nunca terminar en una frase de
     entonación ascendente; revisar cada empalme con `joinspec.py`;
   - apuntar a ≤ 90 s; listar para el dueño cada frase quitada.
5. **Plan de la edición**: crear `videos/<nombre>/plan.py` copiando `videos/1million-black/plan.py`. Usar los bloques de
   `work/blocks.py` (no escribir HTML nuevo salvo que falte un bloque) y dejar que los subtítulos se agrupen solos;
   escribir a mano solo las frases con acentos o con texto oculto bajo un título. Mandarle al dueño el guion
   recortado en texto antes de renderizar si el recorte de contenido es grande. Convenciones:
   - subtítulos blancos pesados de 1 a 3 palabras, centro abajo (línea base ~y 1290), palabras clave en el color de
     acento; se ocultan mientras hay un título; ninguna tarjeta de menos de 0,3 s ni palabras función sueltas;
   - títulos serif grandes para el número o la idea del gancho y para el remate; nombre del producto en grande
     cuando lo dice;
   - tarjetas de datos angostas arriba a la izquierda, **detrás** del orador (matte), con `TOP ≥ 290` para entrar en
     el recorte 4:5 del feed; texto sobre fondo oscuro, nunca directo sobre la pared;
   - una etiqueta con la pregunta del gancho desde el cuadro 0; nada cruza un corte; zooms suaves (1,07–1,13) en
     palabras clave, con vuelta solo en los cortes;
   - cierre: sin placa ni frase; termina en la última palabra con un respiro corto.
6. **Paleta según el video** (variables de `work/theme_default.css`; crear `theme_<nombre>.css` y pasar `--theme`):
   tomar el acento del frasco o de la marca y mantener blanco + vidrio oscuro para lo demás.
   - oscuro/dorado (ámbar, oud, nocturnos): acento dorado `#efab1e`;
   - frescos/cítricos/acuáticos: acento amarillo lima o celeste, vidrio azul muy oscuro;
   - florales/femeninos: rosa viejo o champagne;
   - verdes/aromáticos: verde salvia;
   - eventos, entrevistas, tops: neutro (blanco + un solo acento de la marca), menos tarjetas y más títulos.
   Comprobar siempre el contraste del acento sobre la ropa que tenga puesta.
7. **Render**: `build_project.py --video videos/<nombre>` → `preview.py` (mirar los fotogramas y corregir ahí, que
   tarda segundos) → un solo `make.sh <proyecto> 20 slow`. Si después solo cambia el sonido, rehacer
   `audio_build.py` y remuxar, sin renderizar el video otra vez.
8. **Verificar antes de entregar**: `qa_auto.py <proyecto> <edl> --asr` debe terminar sin fallas (palabras enteras,
   ganancia por palabra, efectos bajo la voz, cortes limpios, subtítulos, tarjetas tapadas, sonoridad, contenedor).
   No usar revisores automáticos (subagentes) salvo un único repaso visual final si algo queda en duda. Además:
   - mirar una hoja de contactos de todo el video (un cuadro por segundo);
   - ortografía rioplatense (aplicás, animás, ananá) y datos en pantalla correctos.
9. **Entregar**: remux a `editado.mov`; enviarlo por el chat (el conector de Drive solo sube hasta 10 MB, así que
   la copia a la carpeta la hace el dueño). Sugerir un cuadro de portada con mirada a cámara y el título visible.
   Resumen: duración, frases quitadas (ofreciendo reponerlas), qué escuchar una vez, de dónde salió cada imagen.

## Límites conocidos
- No se puede escuchar el audio: todo control de sonido es por medición; pedir siempre una escucha.
- Instagram no es navegable desde acá; para contexto de la cuenta usar Metricool y los `editado.mov` de Drive.
- El pipeline es intensivo: usar pocos subagentes y verificar con los scripts antes que con revisores.
