# Editor de video — reseñas verticales (Reels / TikTok / Shorts)

Pipeline reproducible para editar una reseña grabada a cámara (1080×1920) con el estilo de la cuenta:
corta silencios sin cortar palabras, saca muletillas y frases redundantes, agrega subtítulos sincronizados
palabra por palabra, títulos, tarjetas de datos detrás del orador, zooms suaves y efectos de sonido
sintetizados (sin música). Todo se arma desde texto: una lista de cortes (EDL) y un plan de gráficos.

Este repositorio guarda **solo el código y las decisiones de edición**. No incluye el video crudo, los
modelos ni las imágenes de terceros (Fragrantica, stock): eso vive en la carpeta de trabajo local.

## Qué hace cada paso

| Paso | Script | Resultado |
|---|---|---|
| Transcripción | `work/transcribe.py` (faster-whisper large-v3), `work/transcribe_pk.py` (Parakeet) | texto + tiempos aproximados |
| Alineación forzada | `work/falign.py` | `analysis/src_words.json`: cada palabra con inicio y fin (20 ms) |
| Nivel / silencios | `work/vad.py` | `analysis/src_vad.json`: nivel cada 5 ms |
| Lista de cortes | `work/edl.py` + `build/edl/cfg_*.json` | `build/edl/edl_*.json`: segmentos, cortes y palabras en tiempo de edición |
| Silueta del orador | `work/silhouette.py` | `analysis/silhouette_*.json`: dónde hay lugar libre para tarjetas |
| Plan de la edición | `work/build_project.py` + `work/plan_graphics.py` | `project.json` + `overlay/index.html` (subtítulos, gráficos, zooms, sonidos) |
| Sonido | `work/sfx.py`, `work/audio_build.py` | voz procesada a −14 LUFS, pausas atenuadas, efectos sintetizados |
| Gráficos | `work/overlay_render.js` + `build/overlay/runtime.js` | PNG transparentes cuadro a cuadro (Chromium / Playwright) |
| Composición | `work/render.py` | video final H.264 + AAC (espejado corregido, color, zoom, tarjetas detrás del orador con matte) |
| Todo junto | `work/make.sh <carpeta-proyecto> [crf] [preset]` | `out.mp4` |

Herramientas de control: `work/joinspec.py` (espectrogramas de cada empalme), `work/cand_check.py`
(silencio disponible a cada lado de un recorte candidato), `work/preview.py` (fotogramas de prueba),
`work/specplot.py`, `work/probe.py`.

## Carpeta de trabajo

Los scripts toman la raíz de `VIDEO_EDIT_ROOT` (por defecto, la carpeta que contiene `work/`):

```
work/        scripts, estilos, transcripción literal (src_transcript.txt)
build/       edl/ (configuración y lista de cortes), overlay/runtime.js, fonts/, sfx/, <proyecto>/
analysis/    palabras alineadas, nivel, silueta
assets/      fragrantica/, stock/  (solo los manifest.json con el origen de cada imagen)
dl/src/      video crudo (raw.mov)          — no versionado
models/      faster-whisper, MMS aligner, RVM — no versionado
audio/       wav del crudo a 16 k y 48 k     — no versionado
```

## Reproducir la edición

```bash
export VIDEO_EDIT_ROOT=/ruta/a/la/carpeta
python3 -I work/sfx.py build/sfx                       # efectos de sonido
python3 -I work/fetch_fonts.py build/fonts             # tipografías (Google Fonts)
python3 -I work/edl.py build/edl/cfg_v7.json build/edl/edl_v7.json
python3 -I work/build_project.py build/edl/edl_v7.json build/v3 --set silhouette=silhouette_v5.json
work/make.sh build/v3 20 slow                          # audio + gráficos + render
```

Requiere `ffmpeg`, Python 3 con `numpy`, `scipy`, `opencv-python`, `soundfile`, `onnxruntime`,
`faster-whisper`, `torch` + `transformers` (alineación) y Node con Playwright (Chromium).

## Reseña editada: 1 Million Black (Rabanne)

- `build/edl/cfg_v7.json` / `edl_v7.json`: versión final de 89,6 s (12 cortes).
- `build/edl/cfg_v5.json` / `edl_v6.json`: versión larga de 118,5 s (solo silencios, una muletilla y una frase repetida).

Criterio de corte: un corte solo se hace donde hay silencio real a ambos lados; las pausas largas quedan
en 0,12–0,24 s; el contenido se quita por frases enteras cuando repite algo ya dicho o que ya muestra
una tarjeta. Después de cada render se verifica con alineación forzada y una segunda transcripción que
todas las palabras conservadas siguen enteras.

Los efectos de sonido son originales (sintetizados por `work/sfx.py`). Las imágenes de botellas y notas
provienen de Fragrantica y las fotos de stock de Mixkit y Wikimedia Commons; su origen y licencia están
en `assets/*/manifest.json`.
