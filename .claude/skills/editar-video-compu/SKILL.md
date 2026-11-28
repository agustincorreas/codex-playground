---
name: editar-video-compu
description: Variante de escritorio de editar-video, para cuando Agus está en su computadora. Corre el mismo pipeline en su máquina (render más rápido, deja editado.mov directo en la carpeta de Drive) y deja material listo para retocar en CapCut. Usar cuando diga que está en la compu o pida editar "en la compu" / "con CapCut".
---

# Editar un video en la computadora de Agus

Mismas reglas y mismo estilo que `/editar-video` (leer ese skill primero: reglas del dueño, pasos, verificación).
Lo que cambia es **dónde** corre y **cómo se entrega**. ESTADO: sin probar todavía en su máquina; la primera vez,
anotar acá lo que haya que ajustar.

## Dónde está el pipeline
Los scripts viven en la carpeta `editor-video/` del repositorio `agustincorreas/codex-playground`. Si la sesión no está
abierta sobre ese repositorio, usar `~/Documents/codex-playground` (clonarlo de `https://github.com/agustincorreas/codex-playground.git`
si no existe, y hacer `git pull` si existe) y trabajar con `~/Documents/codex-playground/editor-video`. No pedirle al
dueño que lo haga: resolverlo solo.

## Antes de empezar
1. La sesión necesita su computadora adjunta (Remote Control). Si no hay ninguna en línea, decirlo y ofrecer
   `/editar-video` (nube) en su lugar.
2. En su máquina: `ffmpeg`, Python 3 y Node con Playwright. Correr `editor-video/setup.sh <carpeta>` una sola vez; los
   modelos quedan guardados para los próximos videos.
3. Ubicar la carpeta de Google Drive sincronizada (Drive para escritorio). Si existe, el crudo se lee de ahí y el
   `editado.mov` se guarda ahí mismo: no hay límite de 10 MB ni paso manual.

## Diferencias con la versión de nube
- **Render**: usar el codificador por hardware si está (`h264_videotoolbox` en Mac) para la pasada final.
- **Entrega**: copiar `editado.mov` a la carpeta del crudo en Drive **y además armar siempre la página de descarga**
  (decisión del dueño, vale para todos los videos, pesen lo que pesen): `work/download_page.py` + herramienta Artifact, igual
  que en el paso 9 de `editar-video`. Pasarle el link de la página y avisar cuando esté.
- **CapCut**: no manejar CapCut con clics (es lento y frágil; el pipeline por scripts es más rápido y repetible).
  Si el dueño quiere retocar a mano, dejarle en la carpeta del proyecto:
  - `limpio.mp4`: cortes + color + sonido, sin gráficos (`render.py … --no-overlay`);
  - `subtitulos.srt`: `work/export_capcut.py <proyecto> subtitulos.srt` (CapCut los importa como subtítulos);
  - `editado.mov`: la versión completa, por si solo quiere cambiar un detalle encima.
- Si pide explícitamente que se haga dentro de CapCut, explicarle este criterio y preguntar qué retoque puntual
  quiere; no reconstruir toda la edición a mano en la interfaz.
