// Arma lo que la app de escritorio empaqueta: la interfaz compilada (dist/) y el servidor en un solo
// archivo CommonJS (desktop/app/server.cjs) que corre con el Node de Electron, sin tsx ni node_modules.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'desktop', 'app');

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('Falta dist/: corré "npm run build" antes (o usá "npm run build:desktop").');
  process.exit(1);
}

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(join(root, 'dist'), join(app, 'dist'), { recursive: true });

await build({
  entryPoints: [join(root, 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(app, 'server.cjs'),
  // ws tiene aceleradores nativos opcionales (bufferutil, utf-8-validate): se quedan afuera.
  external: ['bufferutil', 'utf-8-validate'],
  // util.ts ubica la raíz con import.meta.url; en CommonJS se arma desde __filename.
  define: { 'import.meta.url': '__pulsoImportMetaUrl' },
  banner: { js: 'const __pulsoImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: 'info',
});

console.log(`Listo: ${app}/server.cjs y ${app}/dist`);
