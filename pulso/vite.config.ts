import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Build "demo": una sola página estática (GitHub Pages / artifact) con React y lightweight-charts
// cargados desde CDN como globales, y el resto del código en línea.
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js',
];

function cdnScripts(): Plugin {
  return {
    name: 'pulso-cdn-scripts',
    transformIndexHtml(html) {
      const tags = CDN.map((src) => `<script src="${src}" crossorigin="anonymous"></script>`).join('\n    ');
      return html.replace('</head>', `    ${tags}\n  </head>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    // Las pruebas del simulador y del servidor entero tardan varios segundos en una máquina cargada.
    test: { testTimeout: 20_000, hookTimeout: 90_000 },
    plugins: [react(), ...(demo ? [cdnScripts()] : [])],
    resolve: demo
      ? { alias: { 'react/jsx-runtime': fileURLToPath(new URL('./src/client/shims/jsx-runtime.ts', import.meta.url)) } }
      : undefined,
    build: demo
      ? {
          outDir: 'dist-demo',
          emptyOutDir: true,
          cssCodeSplit: false,
          rollupOptions: {
            external: ['react', 'react-dom', 'react-dom/client', 'lightweight-charts'],
            output: {
              format: 'iife',
              // Las dependencias en CommonJS (react-grid-layout, react-draggable, react-resizable) piden
              // React con require(): en la página única React llega como global desde el CDN.
              intro:
                'var require = function (n) { if (n === "react") return React; if (n === "react-dom" || n === "react-dom/client") return ReactDOM; throw new Error("Módulo no disponible: " + n); };',
              globals: {
                react: 'React',
                'react-dom': 'ReactDOM',
                'react-dom/client': 'ReactDOM',
                'lightweight-charts': 'LightweightCharts',
              },
            },
          },
        }
      : { outDir: 'dist', emptyOutDir: true },
    server: { port: 5173 },
  };
});
