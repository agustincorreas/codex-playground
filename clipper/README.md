# Clipper — AI clipping para Reels, TikTok y Shorts

App web de un solo usuario: le pegás un link de YouTube (o elegís un video de Google Drive,
o subís un archivo) y te devuelve entre 6 y 15 **candidatos** a clip vertical, elegidos con
Claude a partir de la transcripción. Cada candidato tiene vista previa, ajuste de inicio/fin,
título editable, subtítulos editables por línea y botón **Renderizar**, que produce un
1080×1920 H.264/AAC (máx. 60 MB) con reencuadre automático en la cara de quien habla,
subtítulos quemados sincronizados por palabra y audio a −14 LUFS.

Sin servidores que administrar: Vercel (web) + Supabase (Postgres y Storage) + un
contenedor en Railway o Render (worker con yt-dlp, ffmpeg y OpenCV).

```
clipper/
├── web/        Next.js + Tailwind (Vercel)
├── worker/     Python: cola en Postgres, yt-dlp, ffmpeg, OpenCV, APIs (Dockerfile)
└── supabase/   schema.sql
```

## Cómo funciona

```
link / Drive / archivo
   │
   ▼
[jobs] process_video ──► descarga (yt-dlp 720p máx / Drive API / Storage)
                       ► ffmpeg: audio mono 16 kHz
                       ► transcripción con timestamps por palabra + diarización
                         (Deepgram | AssemblyAI | OpenAI Whisper, por env)
                       ► oraciones numeradas → Claude elige 6-15 candidatos (JSON)
                         (inicio en frase fuerte, fin en cierre de idea, sin muletillas)
                       ► vista previa liviana + miniatura por candidato → Storage
   │
   ▼  (en la UI: revisás, ajustás ±1 s, editás título y subtítulos)
[jobs] render_clip ────► corte exacto → jump cuts (saltear pausas, según preset)
                         → detección de rostros (YuNet) → hablante activo por movimiento
                         de boca + diarización → recorte 9:16 suavizado (o dividido)
                         → subtítulos ASS → música de fondo con ducking (según preset)
                         → loudnorm 2 pasadas → barra de progreso / punch zoom / destello
                         → H.264 con tope de bitrate para no superar 60 MB → Storage
   │
   ▼
descarga individual / zip en el navegador / guardar en Google Drive
```

Tres reglas que aplican a todos los estilos:

- **Silencios**: se saltean las pausas largas, pero el corte se verifica sobre el audio real
  (nivel de señal) y se deja un margen junto a cada palabra, así nunca se corta una palabra
  aunque los tiempos de la transcripción sean imprecisos. Umbrales por preset.
- **Transcripción revisada**: antes de elegir momentos, Claude repasa la transcripción con un
  glosario de materias primas, marcas y perfumes (de fábrica más el tuyo, en Configuración)
  y para los nombres dudosos busca en Fragrantica, Parfumo y Wikipedia. Solo corrige lo que
  está mal oído ("tobacco anilla" → "Tobacco Vanille"), sin reescribir al hablante. Se puede
  apagar con `CORRECT_TRANSCRIPT=false` o sin búsqueda con `CORRECTION_WEB_SEARCH=false`.
- **Duración con sentido**: por defecto 60-150 s. Cada clip tiene que ser una unidad completa
  (principio, desarrollo y fin); se admite hasta 25% más que el máximo para cerrar la idea y,
  si no entra, se descarta en lugar de cortarlo a la mitad. Si el video entero dura menos que
  el máximo, el candidato natural es el video completo desde su primera frase fuerte.

El estado del pipeline se ve en la UI: **descargando → transcribiendo → seleccionando →
listo**, y cada clip: **candidato → en cola → renderizando → renderizado**. Los errores
esperables (video privado, link inválido, transcripción vacía, cookies requeridas, archivo
que no es video, sin crédito en la API…) se muestran con un mensaje claro y un botón
Reintentar.

## Estilos

Seis presets de fábrica, de más sobrio a más cargado. Todos se editan y se clonan desde
**Configuración → Estilos**; al elegir un estilo en el formulario se toma su duración
objetivo (y se puede cambiar a mano).

| Preset | Duración | Subtítulos | Título | Ritmo | Extras |
|---|---|---|---|---|---|
| **Natural minimalista** (predeterminado) | 60-150 s | 1 línea, Inter, blanco con sombra suave, abajo | No | Cortes limpios, sin zoom, saltea pausas > 1 s | Sin música |
| **Editorial** | 60-150 s | 2 líneas, serif | 2 líneas arriba, primeros 3 s | Sin zoom | Sin música |
| **Podcast a dos** | 60-150 s | 2 líneas | Primeros 3 s | Pantalla dividida arriba/abajo con dos personas | Sin música |
| **Intermedio** | 60-150 s | Más grandes, negrita con contorno, 2 líneas | Con caja, primeros 3 s | Saltea pausas > 0.8 s | Sin música |
| **Dinámico** | 60-120 s | Palabra activa resaltada, 2 líneas, **siguen a la persona** | Permanente | Saltea pausas > 0.7 s, punch zoom en cortes y cambios de hablante | Sin música |
| **Viral (cargado)** | 45-120 s | 1-3 palabras por vez, mayúsculas, Montserrat grande al centro, resaltado amarillo, animación pop | Hook grande **por detrás de la persona**, 4 s | Saltea pausas > 0.45 s, punch zoom en cada corte | Música de fondo baja con ducking, barra de progreso |

Cada preset controla:

- **Subtítulos**: tipografía, tamaño, color, posición (abajo, centro, o **siguiendo a la
  persona** bajo el mentón, con el seguimiento de rostro), líneas, caracteres por línea, modo
  frase o 1-3 palabras por vez, negrita, mayúsculas, sombra, contorno, caja de fondo, palabra
  activa resaltada y animación pop.
- **Título**: mostrar u ocultar, permanente o los primeros N segundos, tipografía, tamaño, color,
  líneas, caja de fondo y **por detrás de la persona** (se segmenta a la persona cuadro a cuadro
  con U²-Net y el título queda tapado por ella). Con título permanente el render tarda más.
- **Ritmo y transiciones**: saltear pausas largas (jump cuts) con umbral configurable, transición
  en cada corte (ninguna, punch zoom o destello), zoom al cambiar de hablante, suavizado del
  seguimiento, tratamiento de dos personas (cambiar según quién habla o dividido).
- **Música**: pista al azar de tu biblioteca o una fija, volumen, ducking (baja cuando hay voz) y
  fade out. Las pistas se suben en **Configuración → Música de fondo** (usá música libre de
  derechos; la app no trae ninguna).
- **Barra de progreso** y **márgenes seguros** para que nada quede tapado por la interfaz de
  Instagram y TikTok.

### En qué se basan los presets "cargados"

Lo que se repite en las guías de formato corto para 2026 y en los análisis del estilo de
captions "Hormozi" (fuentes al final):

- **Hook en el primer segundo** y texto en pantalla que refuerce el hook, no un título
  genérico → título con caja arriba durante los primeros segundos.
- **Subtítulos obligatorios** (la mayoría mira sin sonido): grandes, en negrita, 1-3 palabras
  por vez sincronizadas con la voz, palabra activa resaltada en amarillo, tipografía tipo
  Montserrat en mayúsculas con contorno negro, ubicadas en el medio-bajo del cuadro.
- **Ritmo**: quitar pausas y muletillas (jump cuts), un cambio visual cada pocos segundos
  (punch zoom en cortes y cambios de hablante).
- **Sonido**: música de fondo que aporte energía sin tapar la voz.
- **Retención**: barra de progreso y clips cortos (30-60 s) para completar el video.

Fuentes: [Storytella – Complete Guide to Short-Form Video (2026)](https://storytellastudios.com/2026/01/12/the-complete-guide-to-short-form-video/),
[FlowShorts – How to Edit Short-Form Video (2026)](https://flowshorts.app/blog/how-to-edit-short-form-video),
[ShortSync – How to Make Viral Videos in 2026](https://www.shortsync.app/resources/how-to-make-viral-videos-2026),
[Jetfuel – How to Optimize Short-Form Video in 2026](https://jetfuel.agency/how-to-optimize-short-form-video-content-for-success/),
[Miraflow – How to Go Viral in 2026](https://miraflow.ai/blog/how-to-go-viral-2026-what-actually-works-across-platforms),
[Ascynd – Hormozi Captions: font, color and specs](https://ascynd.io/en/blog/hormozi-captions),
[Riverside – How to Make Hormozi Style Videos](https://riverside.com/blog/hormozi-style-videos),
[Joyspace – Hormozi editing style in 2026](https://joyspace.ai/hormozi-editing-style-2026-analysis).

## Entradas

- **Links de YouTube o de Google Drive**, uno o varios (uno por línea) o importados desde un
  archivo `.txt`/`.csv` con un link por línea. Cada link se procesa como un video con los mismos
  ajustes (temas, duración y estilo).
- **Selector de Google Drive** (Google Picker) con tu cuenta conectada.
- **Subida directa** de un archivo mp4, mov, m4a o mp3 (arrastrar y soltar).

---

## Despliegue paso a paso

Necesitás cuentas en: Supabase, Vercel, Railway (o Render), Anthropic, y uno de
Deepgram / AssemblyAI / OpenAI. Google Cloud solo si querés Drive.

### 1. Supabase (base de datos + storage)

1. Creá un proyecto en https://supabase.com (región cercana; free tier alcanza para empezar).
2. **SQL Editor → New query**: pegá el contenido de `supabase/schema.sql` y ejecutalo. Crea las
   tablas `videos`, `clips`, `jobs`, `presets`, `settings`, la función `claim_job()` y el bucket
   privado `clipper`.
3. Anotá, en **Project Settings → API**: `Project URL` (→ `SUPABASE_URL`) y `service_role` key
   (→ `SUPABASE_SERVICE_ROLE_KEY`). Nunca la pongas en el navegador.
4. Anotá, en **Project Settings → Database → Connection string → URI**, la cadena en modo
   **Session** (puerto 5432; el worker mantiene una conexión por consulta y usa
   `FOR UPDATE SKIP LOCKED`, que también funciona en el pooler de transacciones si preferís
   6543). Reemplazá `[YOUR-PASSWORD]` (→ `DATABASE_URL`).
5. Límites a tener en cuenta: en el **free tier** el tamaño máximo por archivo en Storage es
   **50 MB** y el total 1 GB. Alcanza para vistas previas, miniaturas y renders, pero un render
   de más de 50 MB falla al subir: si te quedás en free, poné `MAX_OUTPUT_MB=48` en el worker y
   usá YouTube/Drive en vez de la subida directa para videos largos. Con el plan **Pro**
   (US$25/mes) el límite sube a 5 GB por archivo y 100 GB de almacenamiento.

### 2. Claves de APIs

- **Anthropic**: https://console.anthropic.com → API key (→ `ANTHROPIC_API_KEY`).
- **Transcripción** (elegí una):
  - Deepgram (recomendado, el más barato y con diarización): https://console.deepgram.com → `DEEPGRAM_API_KEY`, `TRANSCRIBE_PROVIDER=deepgram`.
  - AssemblyAI: `ASSEMBLYAI_API_KEY`, `TRANSCRIBE_PROVIDER=assemblyai`.
  - OpenAI Whisper: `OPENAI_API_KEY`, `TRANSCRIBE_PROVIDER=openai`. No diariza (el seguimiento
    de hablante se basa solo en la imagen) y el audio se parte en trozos de 25 min.
  - **Local, sin API**: `TRANSCRIBE_PROVIDER=local`. Whisper corre en el propio worker con
    sherpa-onnx (`pip install sherpa-onnx`, y los modelos `sherpa-onnx-whisper-small` y
    `silero_vad.onnx` de los releases de github.com/k2-fsa/sherpa-onnx en `LOCAL_WHISPER_DIR`
    y `LOCAL_VAD_MODEL`). No diariza, los tiempos por palabra son aproximados y en un
    contenedor de 2 vCPU tarda más o menos lo que dura el audio. Sirve para probar o para
    videos cortos sin gastar en APIs.

### 3. Worker (Railway)

1. En https://railway.app → **New Project → Deploy from GitHub repo**, elegí este repositorio.
2. En el servicio: **Settings → Root Directory** = `clipper/worker`. Railway detecta el
   `Dockerfile`.
3. **Settings → Volumes → Add volume** montado en `/data/clipper` (5-10 GB). Guarda el video
   original mientras revisás los candidatos; si no lo agregás, el worker vuelve a descargar el
   video al renderizar (funciona igual, tarda más).
4. **Variables**: copiá `worker/.env.example` y completá:
   `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `TRANSCRIBE_PROVIDER` + su key, y (si usás Drive) `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
5. Deploy. En los logs tiene que aparecer `worker listo (proveedor de transcripción: ...)`.
   Con eso se cargan los tres presets de fábrica en la base.
6. Recursos: 2 vCPU / 2-4 GB RAM van bien. Un clip de 90 s tarda ~2-4 min en renderizar con
   `X264_PRESET=fast`; subí a `medium` si tenés CPU de sobra.

**Render** en vez de Railway: New → **Background Worker** (no Web Service), runtime Docker, root
`clipper/worker`, disco persistente en `/data/clipper`, mismas variables.

### 4. Web (Vercel)

1. https://vercel.com → **Add New → Project** → importá el repo.
2. **Root Directory** = `clipper/web`. Framework: Next.js (se detecta solo).
3. **Environment Variables** (ver `web/.env.example`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_PASSWORD`: una contraseña para entrar (la app es pública en internet; si la dejás
     vacía, no pide nada). `APP_SECRET`: cualquier string largo aleatorio.
   - `APP_URL`: la URL final, p. ej. `https://clipper-tuusuario.vercel.app` (para el callback de Google).
   - Google (opcional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_API_KEY`,
     `NEXT_PUBLIC_GOOGLE_APP_ID`.
4. Deploy. Entrá con la contraseña, pegá un link de YouTube y **Generar**.

### 5. Google Drive (opcional)

1. https://console.cloud.google.com → proyecto nuevo → **APIs y servicios → Biblioteca**: habilitá
   **Google Drive API** y **Google Picker API**.
2. **Pantalla de consentimiento OAuth**: tipo *Externo*, completá nombre y mails. En **Alcances**
   agregá solo `.../auth/drive.file` (no sensible: la app solo ve los archivos que elegís con el
   selector y los que ella misma crea). Publicá la app (**Publicar → En producción**): con ese
   alcance no requiere verificación, y evita que los tokens venzan a los 7 días como en modo
   "Prueba".
3. **Credenciales → Crear → ID de cliente OAuth → Aplicación web**. URI de redirección autorizada:
   `https://TU-APP.vercel.app/api/google/callback` (y `http://localhost:3000/api/google/callback`
   para desarrollo). Copiá ID y secreto a Vercel **y** al worker.
4. **Credenciales → Crear → Clave de API** → `NEXT_PUBLIC_GOOGLE_API_KEY` (restringila a Picker
   API y a tu dominio). El número de proyecto (Cloud → Configuración) → `NEXT_PUBLIC_GOOGLE_APP_ID`.
5. En la app: **Configuración → Conectar cuenta de Google**. Después podés elegir archivos con el
   selector y guardar los clips renderizados en una carpeta (pegá el link de la carpeta en
   Configuración; para carpetas existentes, elegila una vez con el selector para darle acceso).

Links de Drive pegados a mano funcionan sin conectar ninguna cuenta si el archivo está
compartido como "cualquiera con el link" (se baja por el link público); si no, hace falta
haberlo elegido antes con el selector.

### 6. YouTube y cookies

Dos cosas que YouTube exige hoy y que ya están contempladas:

- **Motor de JavaScript**: yt-dlp necesita Deno (o Node) para resolver las URLs de descarga;
  sin él todo termina en "HTTP Error 403". El Dockerfile instala Deno.
- **Cookies**: desde direcciones IP de centros de datos (Railway, Render, o un entorno de
  Claude Code) YouTube casi siempre responde "Sign in to confirm you're not a bot", incluso
  para videos públicos. Lo mismo pasa con videos con restricción de edad o solo para
  miembros. Exportá tus cookies con la extensión **Get cookies.txt LOCALLY** (formato
  Netscape) desde una sesión logueada y subilas en **Configuración → YouTube: cookies.txt**.
  Se guardan en el bucket privado y el worker las usa en cada descarga. Usá una cuenta
  secundaria si te preocupa el bloqueo de la cuenta. Google Drive no tiene este problema.

### Desarrollo local

```bash
# Worker
cd clipper/worker
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt            # además: ffmpeg y fuentes Inter/Liberation instaladas
cp .env.example .env && set -a && . ./.env && set +a
WORK_DIR=/tmp/clipper python -m clipper_worker.main
pytest                                     # tests unitarios (sin red ni base de datos)

# Web
cd clipper/web
npm install
cp .env.example .env.local                 # completar
npm run dev                                # http://localhost:3000
```

---

## Costo estimado mensual

Supuestos: 20 videos/mes de 90 minutos (30 horas de audio), 10 clips renderizados por video.

| Servicio | Plan | Costo |
|---|---|---|
| Vercel | Hobby | US$0 |
| Supabase | Free (o Pro si querés renders > 50 MB y subidas grandes) | US$0 (Pro: US$25) |
| Railway (worker 2 vCPU / 4 GB, activo ~30 h/mes, volumen 10 GB) | Hobby | ~US$8-15 |
| Deepgram Nova (30 h × US$0.0077/min ≈ 1800 min) | pago por uso | ~US$14 |
| Claude Opus 5 (20 llamadas × ~40k tokens de entrada + ~3k de salida) | pago por uso | ~US$5-6 |
| Google Cloud (Drive API) | gratis | US$0 |
| **Total** | | **~US$30/mes** (≈ US$55 con Supabase Pro) |

Alternativas: AssemblyAI ≈ US$0.15/h → ~US$5; OpenAI Whisper US$0.006/min → ~US$11.
Con `CLAUDE_MODEL=claude-sonnet-5` la selección cuesta ~US$2.

## Variables de entorno

Ver `worker/.env.example` y `web/.env.example`. Las importantes:

| Variable | Dónde | Para qué |
|---|---|---|
| `DATABASE_URL` | worker | Postgres de Supabase (cola de trabajos, datos) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ambos | Storage y datos |
| `TRANSCRIBE_PROVIDER` + `DEEPGRAM_API_KEY` / `ASSEMBLYAI_API_KEY` / `OPENAI_API_KEY` | worker | Transcripción |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (`claude-opus-5`), `CLAUDE_EFFORT` | worker | Selección de momentos |
| `MIN_CANDIDATES` / `MAX_CANDIDATES` | worker | Cantidad de candidatos (6-15) |
| `MAX_OUTPUT_MB`, `X264_PRESET`, `YTDLP_MAX_HEIGHT`, `PREVIEW_PAD_S` | worker | Render y descarga |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ambos | OAuth de Drive |
| `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_APP_ID` | web | Google Picker |
| `APP_PASSWORD`, `APP_SECRET`, `APP_URL` | web | Acceso y callback |

## Detalles de implementación

- **Cola**: tabla `jobs` + función `claim_job()` con `FOR UPDATE SKIP LOCKED`. Un solo worker
  alcanza; si corrés dos, no se pisan. Los trabajos que quedan colgados por un reinicio se
  re-encolan (hasta 3 intentos).
- **Selección**: la transcripción se convierte en oraciones numeradas (por puntuación, pausas
  > 0.8 s y cambio de hablante) y Claude devuelve índices de oración de inicio/fin, así el clip
  siempre arranca y termina en límite de oración. Después se saltean muletillas al inicio
  ("bueno", "eh", "o sea", "digamos", "a ver"...), se ajusta la duración al rango pedido y se
  descartan solapamientos. Usa structured outputs (`messages.parse` + Pydantic) con
  `thinking: adaptive`.
- **Reencuadre**: OpenCV YuNet detecta rostros 5 veces por segundo; se arman tracks por persona;
  el hablante activo se estima por movimiento de la región de la boca (con histéresis) y los
  cambios de hablante de la diarización sirven de pista para cortar antes. El centro del recorte
  se suaviza con zona muerta (no tiembla); un cambio de hablante es un corte limpio.
  Con dos personas y `two_speakers: split`, se arman dos paneles 1080×960.
- **Subtítulos**: se generan cues (bloques) a partir de las palabras, respetando el largo máximo
  por línea del preset, y se queman con libass (ASS) con `\blur` para la sombra suave. En modo
  resaltado hay un evento por palabra. Las ediciones por línea se guardan por clave (inicio del
  cue en ms) y se re-aplican al renderizar aunque muevas el inicio/fin.
- **Tamaño**: el bitrate de video se limita con `maxrate` según la duración para no pasar los
  60 MB; si igual se pasa, se re-codifica a bitrate fijo.
- **Vista previa**: por candidato se genera un proxy 360p de (inicio − 20 s, fin + 20 s), así el
  original no tiene que subir a Storage y el ajuste fino tiene margen a ambos lados.
- **Jump cuts**: se detectan las pausas entre palabras de la transcripción más largas que el
  umbral del preset, se verifica sobre el RMS del audio cuál es el tramo realmente silencioso
  (con margen junto a cada palabra) y se quita con `select`/`aselect` de ffmpeg dejando un
  poco de aire; los tiempos de las palabras se remapean para que los subtítulos sigan
  sincronizados, y cada salto es un corte limpio del encuadre (con punch zoom o destello si
  el preset lo pide).
- **Corrección de transcripción**: Claude devuelve reemplazos de frases cortas ("from" →
  "to") que se aplican sobre las palabras conservando los tiempos; con la herramienta de
  búsqueda web del modelo restringida a fragrantica.com, parfumo.com y wikipedia.org.
- **Subtítulos que siguen a la persona**: el ancla es un punto bajo el mentón del rostro más
  cercano al centro del encuadre, en coordenadas de salida, suavizado y acotado a los
  márgenes; los eventos ASS se parten en tramos de 0,25 s con `\move`.
- **Título por detrás**: el título se dibuja con Pillow, se compone sobre el cuadro y la
  persona (máscara de U²-Net human_seg, suavizada entre cuadros) vuelve a ponerse encima.
- **Música**: la pista se pone en loop, se baja al volumen del preset, se comprime con
  sidechain usando la voz (ducking), se le hace fade out y recién después se normaliza a
  −14 LUFS junto con la voz.
