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
[jobs] render_clip ────► corte exacto → detección de rostros (YuNet) → hablante activo
                         por movimiento de boca + diarización → recorte 9:16 suavizado
                         (o dividido arriba/abajo) → subtítulos ASS → loudnorm 2 pasadas
                         → H.264 con tope de bitrate para no superar 60 MB → Storage
   │
   ▼
descarga individual / zip en el navegador / guardar en Google Drive
```

El estado del pipeline se ve en la UI: **descargando → transcribiendo → seleccionando →
listo**, y cada clip: **candidato → en cola → renderizando → renderizado**. Los errores
esperables (video privado, link inválido, transcripción vacía, cookies requeridas, archivo
que no es video, sin crédito en la API…) se muestran con un mensaje claro y un botón
Reintentar.

## Estilos

Tres presets de fábrica, editables y clonables desde **Configuración → Estilos**:

| Preset | Subtítulos | Título | Cámara |
|---|---|---|---|
| **Natural minimalista** (predeterminado) | 1 línea, Inter, blanco con sombra suave, abajo al centro. Sin resaltados. | No | Sin zooms, cortes limpios |
| **Editorial** | 2 líneas, serif | 2 líneas arriba, primeros 3 s | Sin zooms |
| **Dinámico** | Palabra activa resaltada, 2 líneas, negrita | Permanente | Leve zoom en cambios de hablante |

Cada preset controla tipografía, tamaño, color, posición y líneas de subtítulos;
mostrar/ocultar título; efectos de cámara; tratamiento de dos hablantes (cambiar según quién
habla o dividido arriba/abajo) y márgenes seguros para que nada quede tapado por la interfaz
de Instagram/TikTok. Se guardan como JSON en la tabla `presets`.

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

Links de Drive pegados a mano solo funcionan si el archivo está compartido como "cualquiera
con el link" o si ya lo elegiste antes con el selector.

### 6. YouTube y cookies

yt-dlp descarga videos públicos y no listados sin nada más. Si YouTube responde "Sign in to
confirm you're not a bot", el video tiene restricción de edad o es solo para miembros, exportá
tus cookies con la extensión **Get cookies.txt LOCALLY** (formato Netscape) desde una sesión
logueada y subilas en **Configuración → YouTube: cookies.txt**. Se guardan en el bucket
privado y el worker las usa en cada descarga. Usá una cuenta secundaria si te preocupa el
bloqueo de la cuenta.

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
