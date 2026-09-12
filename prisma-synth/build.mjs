// Genera dist/prisma-synth.html: un único archivo con CSS, módulos JS y el
// worklet embebido (se carga como Blob), para abrirlo sin servidor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const order = ['js/shared/params.js', 'js/presets.js', 'js/ui/keyboard.js', 'js/ui/visualizer.js', 'js/ui/knob.js', 'js/audio/engine.js', 'js/main.js'];
const strip = (src) => src
  .split('\n')
  .filter(l => !/^import\s.*from\s+['"]/.test(l))
  .map(l => l.replace(/^export\s+(const|let|function|class|async function)\s/, '$1 '))
  .join('\n');
const bundle = order.map(f => `// ---- ${f}\n${strip(read(f))}`).join('\n\n');
const worklet = read('js/audio/synth-processor.js');
if (worklet.includes('</script')) throw new Error('worklet contiene </script');
const css = read('css/style.css');
let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>',
  `<script type="text/plain" id="worklet-src">\n${worklet}\n</script>\n  <script type="module">\n${bundle}\n</script>`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/prisma-synth.html'), html);
console.log(`dist/prisma-synth.html: ${(html.length / 1024).toFixed(0)} KB`);

// --artifact <dir>: variante para hosts que envuelven el HTML (sin doctype/html/head/body)
// y sirven el worklet como archivo aparte junto a la página.
const ai = process.argv.indexOf('--artifact');
if (ai > 0) {
  const dir = process.argv[ai + 1];
  mkdirSync(dir, { recursive: true });
  const bodyStart = html.indexOf('<body>') + '<body>'.length, bodyEnd = html.lastIndexOf('</body>');
  let inner = html.slice(bodyStart, bodyEnd);
  inner = inner.replace(/<script type="text\/plain" id="worklet-src">[\s\S]*?<\/script>\n\s*/, '');
  const page = `<title>Prisma Synth</title>\n<style>\n${css}\n</style>\n${inner}`;
  writeFileSync(join(dir, 'index.html'), page);
  writeFileSync(join(dir, 'synth-processor.js'), worklet);
  console.log(`${dir}/index.html + synth-processor.js`);
}
