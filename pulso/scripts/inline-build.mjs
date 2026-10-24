// Después de `vite build --mode demo`: mete el JS y el CSS dentro del HTML para tener una sola página.
//   dist-demo/index.html     → documento completo (GitHub Pages o abrirlo directo)
//   dist-demo/artifact.html  → la misma página sin <html>/<head>/<body> (para publicarla como artifact)
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-demo';
let html = readFileSync(join(dir, 'index.html'), 'utf8');
let js = '';
let css = '';

html = html.replace(/<script type="module" crossorigin src="\/?(assets\/[^"]+\.js)"><\/script>\s*/, (_, p) => {
  js = readFileSync(join(dir, p), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '';
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\/?(assets\/[^"]+\.css)">\s*/, (_, p) => {
  css = readFileSync(join(dir, p), 'utf8');
  return '';
});
if (!js || !css) throw new Error('No encontré el JS o el CSS compilados en el HTML.');

// Reemplazos con función: en un string de reemplazo, secuencias como $' o $& del código minificado
// se interpretarían como patrones especiales y duplicarían partes del HTML.
html = html.replace('</head>', () => `  <style>${css}</style>\n  </head>`).replace('</body>', () => `  <script type="module">${js}</script>\n  </body>`);
writeFileSync(join(dir, 'index.html'), html);

// Fragmento para el artifact: título, fuentes, estilos, scripts de CDN, raíz y el script de la app.
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]).join('\n');
const fragment = [
  pick(/<title>[\s\S]*?<\/title>/g),
  '<meta name="claude:viewport-fit-sides" content="cover">',
  pick(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g),
  `<style>${css}</style>`,
  pick(/<script src="https:[^"]+"[^>]*><\/script>/g),
  '<div id="root"></div>',
  `<script type="module">${js}</script>`,
].join('\n');
writeFileSync(join(dir, 'artifact.html'), fragment + '\n');
rmSync(join(dir, 'assets'), { recursive: true, force: true });
console.log(`Listo: ${dir}/index.html (${Math.round(html.length / 1024)} KB) y ${dir}/artifact.html`);
