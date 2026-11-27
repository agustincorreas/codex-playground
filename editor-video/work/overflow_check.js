// usage: node overflow_check.js <overlay/index.html>   -> lists every glass card / label whose text sticks out of its box, or any element outside the 1080x1920 frame (exit 1 if any)
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
  await page.goto('file://' + path.resolve(process.argv[2]));
  await page.evaluate(async () => { await document.fonts.ready; });
  const bad = await page.evaluate(() => {
    const out = [];
    for (const it of document.querySelectorAll('.item')) {
      it.style.display = '';                                   // measure every item, whatever its time window
      for (const box of it.querySelectorAll('.glass, .pill, .note-chip, .plate')) {
        const B = box.getBoundingClientRect(); if (!B.width) continue;
        if (B.left < 8 || B.right > 1072) out.push(`fuera de cuadro (${Math.round(B.left)}..${Math.round(B.right)}): "${box.innerText.replace(/\s+/g, ' ').slice(0, 50)}" @ ${it.dataset.t0}s`);
        const seen = new Set();
        for (const el of box.querySelectorAll('*')) {
          if (el.children.length || !el.innerText || !el.innerText.trim()) continue;
          const r = document.createRange(); r.selectNodeContents(el); const R = r.getBoundingClientRect();
          const over = Math.max(R.right - B.right, B.left - R.left);
          const key = el.innerText.trim();
          if (over > -6 && !seen.has(key)) { seen.add(key); out.push(`texto ${over > 0 ? 'fuera' : 'pegado al borde'} del recuadro (${Math.round(over)} px): "${key.slice(0, 50)}" @ ${it.dataset.t0}s (recuadro de ${Math.round(B.width)} px)`); }
        }
      }
    }
    return out;
  });
  await b.close();
  if (bad.length) { console.log('DESBORDES:'); bad.forEach(x => console.log('  - ' + x)); process.exit(1); }
  console.log('recuadros: ningún texto sale de su caja');
})().catch(e => { console.error(e); process.exit(2); });
