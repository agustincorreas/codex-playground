// usage: node overlay_still.js <html> <outdir> <nframes> <fps> <layer> <k1,k2,...>   -> PNGs + manifest.json (null except requested frames)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const [html, outdir, nfS, fpsS, layer, list] = process.argv.slice(2);
  const n = parseInt(nfS), fps = parseFloat(fpsS); const ks = list.split(',').map(Number);
  fs.mkdirSync(outdir, { recursive: true });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE ERROR:', m.text()); });
  page.on('pageerror', e => console.error('PAGE EXCEPTION:', e.message));
  await page.goto('file://' + path.resolve(html) + '?layer=' + layer);
  await page.evaluate(async () => { await window.prepare(); });
  const manifest = new Array(n).fill(null);
  for (const k of ks) {
    const sig = await page.evaluate(t => window.renderFrame(t), k / fps);
    if (sig === '') continue;
    const f = `ov_${String(k).padStart(5, '0')}.png`;
    await page.screenshot({ path: path.join(outdir, f), omitBackground: true, type: 'png' }); manifest[k] = f;
  }
  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
