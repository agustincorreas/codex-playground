"""Arma una página de descarga (Artifact) para entregar videos pesados: el chat no deja bajarlos, Drive acepta ~3 MB por subida y GitHub no es lugar para videos.
usage: download_page.py <carpeta_salida> <titulo> <video1> "<nombre visible 1>" [<video2> "<nombre visible 2>" ...]
Deja <carpeta_salida>/index.html y v/<clave>.partNN.mp4 (partes de 14 MB; cada archivo de un Artifact admite hasta 15 MB).
Publicar con la herramienta Artifact: file_path=index.html, root=<carpeta_salida>, capabilities={"downloads": true}, icon="video",
y las partes en `files` de a 4 por publicación (límite de 64 MB por publicación; las siguientes publicaciones al mismo archivo suman partes).
La página junta las partes y guarda un .mp4 (la capacidad `downloads` rechaza .mov salvo los firmados por la plataforma)."""
import sys, os, subprocess, base64, html, json
out, title, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(f"{out}/v", exist_ok=True); PART = 14 * 1024 * 1024; cards = []
for n, (src, label) in enumerate(zip(rest[0::2], rest[1::2])):
    key = f"video{n + 1}"; mp4 = f"{out}/{key}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c", "copy", "-movflags", "+faststart", mp4], check=True)
    data = open(mp4, "rb").read(); parts = [data[i:i + PART] for i in range(0, len(data), PART)]
    for i, p in enumerate(parts): open(f"{out}/v/{key}.part{i:02d}.mp4", "wb").write(p)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], capture_output=True, text=True).stdout)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{min(2.0, dur / 2):.2f}", "-i", mp4, "-frames:v", "1", "-vf", "scale=270:-2", "-q:v", "6", f"{out}/{key}.jpg"], check=True)
    poster = base64.b64encode(open(f"{out}/{key}.jpg", "rb").read()).decode(); os.remove(mp4); os.remove(f"{out}/{key}.jpg")
    name = os.path.splitext(os.path.basename(src))[0] + ".mp4"
    cards.append(f'''<section class="card" data-key="{key}" data-parts="{len(parts)}" data-size="{len(data)}" data-name="{html.escape(name)}">
  <img alt="" src="data:image/jpeg;base64,{poster}"><div class="info"><h2>{html.escape(label)}</h2>
  <p class="facts">{int(dur // 60)}:{int(dur % 60):02d} · {len(data) / 1048576:.0f} MB · MP4</p>
  <button type="button">Descargar</button><progress max="1" value="0" hidden></progress><p class="status" role="status"></p></div></section>''')
    print(key, name, len(parts), "partes")
page = '''<title>__T__</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root { --bg:#f6f3ee; --card:#fff; --fg:#1d1b18; --muted:#6b655c; --line:#e2dcd2; --accent:#2f7d53; --accent-fg:#fff; --warn:#a4541a }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#16150f; --card:#211f18; --fg:#f1ede4; --muted:#a8a193; --line:#35322a; --accent:#6fcf97; --accent-fg:#10210f; --warn:#f0a868; color-scheme:dark } }
:root[data-theme="dark"] { --bg:#16150f; --card:#211f18; --fg:#f1ede4; --muted:#a8a193; --line:#35322a; --accent:#6fcf97; --accent-fg:#10210f; --warn:#f0a868; color-scheme:dark }
body { background:var(--bg); color:var(--fg); font:400 16px/1.5 system-ui,sans-serif; padding-block:28px 40px; padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px)) }
main { max-width:640px; margin:0 auto; display:flex; flex-direction:column; gap:20px }
h1 { font:700 28px/1.15 system-ui,sans-serif; margin:0; text-wrap:balance } .lead,.facts,.status { color:var(--muted); margin:0 } .facts,.status { font-size:14px } .status { min-height:1.5em } .status.err { color:var(--warn) }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; display:flex; gap:16px; align-items:flex-start } .card img { width:96px; border-radius:10px; flex:none }
.info { min-width:0; flex:1; display:flex; flex-direction:column; gap:10px } h2 { font:700 18px/1.25 system-ui,sans-serif; margin:0 }
button { font:600 16px/1 system-ui,sans-serif; background:var(--accent); color:var(--accent-fg); border:0; border-radius:12px; padding:14px 18px; cursor:pointer; align-self:flex-start } button:disabled { opacity:.6 }
button:focus-visible { outline:3px solid var(--fg); outline-offset:2px } progress { width:100%; height:8px; accent-color:var(--accent) }
</style>
<main><h1>__T__</h1><p class="lead">Tocá “Descargar”: primero se prepara el archivo y después Claude te pide confirmar el guardado.</p>
__CARDS__</main>
<script>
(function () {
  var blobs = {}; function pad(n) { return (n < 10 ? "0" : "") + n; }
  document.querySelectorAll(".card").forEach(function (card) {
    var key = card.dataset.key, btn = card.querySelector("button"), pr = card.querySelector("progress"), st = card.querySelector(".status");
    btn.addEventListener("click", async function () {
      btn.disabled = true; st.className = "status";
      try {
        var dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
        if (!dl) { st.className = "status err"; st.textContent = "Esta vista no permite guardar archivos. Abrí la página en un navegador."; btn.disabled = false; return; }
        if (!blobs[key]) {
          var parts = +card.dataset.parts, total = +card.dataset.size, got = 0, chunks = []; pr.hidden = false;
          for (var i = 0; i < parts; i++) {
            var r = await fetch("v/" + key + ".part" + pad(i) + ".mp4"); if (!r.ok) throw new Error("parte " + i + " (" + r.status + ")");
            var b = await r.blob(); chunks.push(b); got += b.size; pr.value = got / total; st.textContent = "Preparando… " + Math.round(100 * got / total) + " %";
          }
          if (got !== total) throw new Error("tamaño inesperado"); blobs[key] = new Blob(chunks, { type: "video/mp4" });
        }
        st.textContent = "Listo. Confirmá el guardado en el aviso de Claude."; btn.textContent = "Guardar de nuevo";
        await dl.save({ filename: card.dataset.name, data: blobs[key] }); st.textContent = "Guardado: " + card.dataset.name;
      } catch (e) {
        var code = e && e.code; st.className = "status err";
        st.textContent = code === "declined" ? "No se guardó porque cancelaste el aviso. Tocá de nuevo para reintentar."
          : code === "rate_limited" ? "Hay otro aviso de guardado abierto. Esperá unos segundos y tocá de nuevo."
          : code === "host_unavailable" || code === "unavailable" ? "Esta app no puede guardar archivos. Abrí la página en un navegador."
          : code === "too_large" ? "Esta app no acepta un archivo de este tamaño. Probá desde Chrome en una computadora."
          : "No se pudo descargar (" + (code || (e && e.message) || "error") + "). Tocá de nuevo para reintentar.";
      }
      btn.disabled = false;
    });
  });
})();
</script>
'''
open(f"{out}/index.html", "w").write(page.replace("__T__", html.escape(title)).replace("__CARDS__", "\n".join(cards)))
print("index.html listo;", sum(len(os.listdir(f"{out}/v")) for _ in [0]), "partes en v/")
