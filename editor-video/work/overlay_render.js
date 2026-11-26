// Render the HTML overlay timeline to transparent PNG frames with Playwright.
// usage: node overlay_render.js <html> <outdir> <nframes> <fps> [startFrame endFrame] [workers]
// The page must expose window.renderFrame(t) -> signature string ('' when nothing is visible).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [html, outdir, nfS, fpsS, sS, eS, wS] = process.argv.slice(2);
  const nframes = parseInt(nfS), fps = parseFloat(fpsS);
  const start = sS ? parseInt(sS) : 0, end = eS ? parseInt(eS) : nframes;
  const workers = wS ? parseInt(wS) : 3;
  fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch();
  const total = end - start;
  const chunk = Math.ceil(total / workers);
  const manifest = new Array(nframes).fill(null);
  let done = 0, shots = 0;
  const t0 = Date.now();
  async function work(a, b) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.error('PAGE ERROR:', m.text()); });
    page.on('pageerror', e => console.error('PAGE EXCEPTION:', e.message));
    const [hp, hq] = html.split('?'); await page.goto('file://' + path.resolve(hp) + (hq ? '?' + hq : ''));
    await page.evaluate(async () => { await document.fonts.ready; if (window.prepare) await window.prepare(); });
    let prevSig = null, prevFile = null;
    for (let k = a; k < b; k++) {
      const sig = await page.evaluate(t => window.renderFrame(t), k / fps);
      if (sig === '') { manifest[k] = null; prevSig = ''; prevFile = null; }
      else if (sig === prevSig) { manifest[k] = prevFile; }
      else {
        const f = `ov_${String(k).padStart(5, '0')}.png`;
        await page.screenshot({ path: path.join(outdir, f), omitBackground: true, type: 'png' });
        manifest[k] = f; prevSig = sig; prevFile = f; shots++;
      }
      done++;
      if (done % 300 === 0) console.log(`  overlay ${done}/${total} frames, ${shots} screenshots, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await ctx.close();
  }
  const jobs = [];
  for (let a = start; a < end; a += chunk) jobs.push(work(a, Math.min(end, a + chunk)));
  await Promise.all(jobs);
  await browser.close();
  // merge with an existing manifest when rendering a sub-range
  const mf = path.join(outdir, 'manifest.json');
  let prev = null;
  if ((start > 0 || end < nframes) && fs.existsSync(mf)) { try { prev = JSON.parse(fs.readFileSync(mf)); } catch (e) {} }
  if (prev && prev.length === nframes) { for (let k = start; k < end; k++) prev[k] = manifest[k]; fs.writeFileSync(mf, JSON.stringify(prev)); }
  else fs.writeFileSync(mf, JSON.stringify(manifest));
  console.log(`overlay done: ${total} frames, ${shots} screenshots in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error(e); process.exit(1); });
