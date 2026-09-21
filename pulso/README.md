# Pulso — práctica musical gamificada (inspirada en Melodics)

Aplicación multiplataforma (PWA) para aprender **teclado, pads y batería** con lecciones interactivas,
feedback de timing en tiempo real, puntaje, estrellas, récords, metas diarias, rachas, trofeos y nivel.
Funciona en la computadora (Chrome, Edge, Firefox, Safari) y en el celular (instalable como app, offline).

## Funciones

| Área | Detalle |
| --- | --- |
| Instrumentos | 🎹 Teclado (C3–C6), 🎛️ Pads 4×4, 🥁 Batería (8 piezas, mapeo General MIDI). |
| Entrada | **MIDI** (Web MIDI: teclados, pads, baterías electrónicas), **teclado de la computadora** (mapeo tipo DAW, Z/X cambia octava) y **pantalla táctil** con el instrumento en pantalla (multitouch, glissando en el piano, vibración). |
| Lecciones | 60+ lecciones en 3 instrumentos, grados 1–16, géneros (rock, funk, hip hop, latin, house, techno, trap, jazz, blues, lo-fi…). Cada lección tiene pasos progresivos + una **Performance** final. Cursos, canciones originales, ejercicios (rudimentos) y calentamientos (escalas). |
| Feedback | Notas coloreadas al tocarlas: **verde** a tiempo, **naranja** temprano, **violeta** tarde, **rojo** perdida; notas extra penalizan. Puntaje 0–100, racha de aciertos, HUD en vivo. |
| Estrellas y récords | ⭐ 60 · ⭐⭐ 80 · ⭐⭐⭐ 95. Con 2 estrellas ganás el **récord** de la lección. XP y **nivel**. |
| Modo práctica | **Loop** por compases, **BPM** ajustable (30–240), **Wait Mode** (la reproducción se detiene hasta que tocás la nota correcta), **Auto BPM** (+10 BPM cada pase con ≥ 90 % hasta el tempo original), cuenta de entrada, metrónomo, sonido guía y base de acompañamiento. |
| Hábitos | **Meta diaria** (5–30 min) con anillo de progreso, **rachas** (días consecutivos con ≥ 5 min), **trofeos** (18), historial por lección, gráfico semanal, mapa de actividad de 12 semanas. |
| Ajustes | Dispositivo MIDI, **calibración de latencia** (8 golpes contra un clic), volúmenes, velocidad de notas, nombres Do-Re-Mi o C-D-E, manos (L/R) en teclado, idioma ES/EN, tema oscuro/claro/sistema, plan gratis (5 lecciones/día, grados 1–2) o Premium (demo). |
| Plataforma | PWA instalable con service worker (offline), safe areas iOS, barra de pestañas en móvil, barra lateral en escritorio, modo apaisado optimizado en el celular. |

## Correr en local

```bash
cd pulso
npm install
npm run dev        # http://localhost:5173 (usá --host para abrir desde el celular en la misma red)
npm run build      # typecheck + build en dist/
npm run preview
```

> Web MIDI requiere Chrome / Edge / Opera (en escritorio y Android). En iOS usá la pantalla táctil o un teclado Bluetooth.
> El audio se desbloquea con el primer toque (política de autoplay de los navegadores).

## Deploy

- **Cualquier hosting estático** (Netlify, Vercel, Firebase Hosting, GitHub Pages): subí `dist/`.
- Para una subruta (por ejemplo GitHub Pages en `/codex-playground/pulso/`) compilá con `VITE_BASE=/codex-playground/pulso/ npm run build`.

## Apps nativas (opcional)

La PWA se instala desde el navegador en Android, iOS, Windows y macOS. Si querés publicarla en las tiendas,
`capacitor.config.json` ya apunta a `dist/`:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
npm run build
npx cap add android && npx cap add ios
npx cap sync && npx cap open android
```

## Estructura

```
src/
  audio/engine.ts        síntesis Web Audio (batería, pads, piano eléctrico, metrónomo, base)
  input/inputManager.ts  MIDI + teclado + táctil → eventos unificados con reloj de audio
  engine/                tipos, instrumentos y mapeos, scoring (ventanas ±45/±130 ms), transporte del reproductor
  content/               DSL de patrones (grilla de 16avos / melodías) y catálogo de lecciones, cursos, canciones
  store/useStore.ts      estado persistente (zustand): progreso, práctica diaria, rachas, trofeos, ajustes
  i18n/                  textos ES/EN
  components/            pista de notas (canvas), instrumentos táctiles, resultados, UI
  screens/               onboarding, inicio, lecciones, cursos, detalle, reproductor, progreso, ajustes
```

## Cómo se evalúa el timing

Cada golpe se compara con la nota más cercana de su carril dentro de ±130 ms (más la compensación de latencia):
±45 ms = a tiempo (100 %), hasta ±130 ms = temprano/tarde (60 %), fuera = perdida (0 %). Las notas extra restan hasta 25 puntos.
