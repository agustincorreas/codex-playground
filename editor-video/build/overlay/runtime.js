// Deterministic overlay runtime: every animated element declares its timing in data-attributes
// (absolute seconds on the OUTPUT timeline); renderFrame(t) computes all styles from t alone.
//
// Item root:      <div class="item" data-t0 data-t1 data-layer="front|back">  (display:none outside [t0,t1))
// Animated child: data-in="12.40" [data-anim="up|fade|pop|word|grow|wipe|scale|none"] [data-dur="0.33"] [data-dist="36"]
//                 [data-out="15.2"] [data-outanim="fade|down|up|cut|shrink"] [data-outdur="0.16"]
//                 [data-count="0,48"]   (text counts between two numbers during the entrance)
//                 [data-drift="dx,dy,ds"] (px/s, px/s, scale/s continuous motion while visible, relative to data-in)
(function () {
  const E = {
    linear: u => u,
    outCubic: u => 1 - Math.pow(1 - u, 3),
    outQuart: u => 1 - Math.pow(1 - u, 4),
    outExpo: u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
    inCubic: u => u * u * u,
    inOut: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    outBack: u => { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
  };
  const clamp01 = u => Math.max(0, Math.min(1, u));
  const FPS = 30, EPS = 1e-6;
  let items = [], anims = [];
  const layer = new URLSearchParams(location.search).get('layer');

  window.prepare = async function () {
    await Promise.all([...document.fonts].map(f => f.load().catch(() => null)));
    await document.fonts.ready;
    const imgs = [...document.images];
    await Promise.all(imgs.map(im => (im.decode ? im.decode().catch(() => null) : null)));
    items = [...document.querySelectorAll('.item')].map(el => ({
      el, t0: parseFloat(el.dataset.t0), t1: parseFloat(el.dataset.t1), on: null,
      keep: !layer || (el.dataset.layer || 'front') === layer,
      kids: [...el.querySelectorAll('[data-in]')].map(k => ({
        el: k, tin: parseFloat(k.dataset.in), anim: k.dataset.anim || 'up', dur: parseFloat(k.dataset.dur || '0.33'),
        dist: parseFloat(k.dataset.dist || '36'), ease: k.dataset.ease || null,
        tout: k.dataset.out !== undefined ? parseFloat(k.dataset.out) : null, outanim: k.dataset.outanim || 'fade', outdur: parseFloat(k.dataset.outdur || '0.16'),
        count: k.dataset.count ? k.dataset.count.split(',').map(Number) : null, countFmt: k.dataset.countfmt || '',
        drift: k.dataset.drift ? k.dataset.drift.split(',').map(Number) : null, last: null,
        base: (() => { const f = getComputedStyle(k).filter; return f && f !== 'none' ? f : ''; })(),
      })),
    }));
    for (const it of items) if (!it.keep) it.el.style.display = 'none';
    return items.length;
  };

  function styleFor(k, t) {
    let op = 1, tx = 0, ty = 0, sc = 1, sx = 1, blur = 0, clip = null, text = null;
    const u = clamp01((t - k.tin) / Math.max(EPS, k.dur));
    if (t < k.tin - EPS) op = 0;
    else {
      switch (k.anim) {
        case 'up': { const e = E[k.ease || 'outQuart'](u); op = clamp01(u * 2.2); ty = (1 - e) * k.dist; blur = (1 - e) * 7; break; }
        case 'down': { const e = E[k.ease || 'outQuart'](u); op = clamp01(u * 2.2); ty = -(1 - e) * k.dist; blur = (1 - e) * 7; break; }
        case 'left': { const e = E[k.ease || 'outQuart'](u); op = clamp01(u * 2.2); tx = (1 - e) * k.dist; blur = (1 - e) * 5; break; }
        case 'right': { const e = E[k.ease || 'outQuart'](u); op = clamp01(u * 2.2); tx = -(1 - e) * k.dist; blur = (1 - e) * 5; break; }
        case 'fade': { op = E[k.ease || 'outCubic'](u); break; }
        case 'pop': { const e = E[k.ease || 'outBack'](u); op = clamp01(u * 3); sc = 0.82 + 0.18 * e; break; }
        case 'scale': { const e = E[k.ease || 'outQuart'](u); op = clamp01(u * 2.5); sc = 1.12 - 0.12 * e; blur = (1 - e) * 5; break; }
        case 'word': { const e = E[k.ease || 'outCubic'](u); op = clamp01(u * 1.6); ty = (1 - e) * 10; sc = 0.94 + 0.06 * e; break; }
        case 'grow': { sx = E[k.ease || 'inOut'](u); break; }
        case 'wipe': { const e = E[k.ease || 'outQuart'](u); clip = `inset(0 ${((1 - e) * 100).toFixed(2)}% 0 0)`; break; }
        case 'none': default: break;
      }
      if (k.count) { const e = E.outCubic(u); const v = k.count[0] + (k.count[1] - k.count[0]) * e; text = (k.count[1] % 1 === 0 && k.count[0] % 1 === 0 ? Math.round(v).toString() : v.toFixed(1).replace('.', ',')) + k.countFmt; }
      if (k.drift) { const dt = Math.max(0, t - k.tin); tx += k.drift[0] * dt; ty += k.drift[1] * dt; sc *= 1 + k.drift[2] * dt; }
    }
    if (k.tout !== null && t >= k.tout - EPS) {
      const v = clamp01((t - k.tout) / Math.max(EPS, k.outdur));
      switch (k.outanim) {
        case 'cut': op = 0; break;
        case 'down': { const e = E.inCubic(v); op *= 1 - v; ty += e * 26; break; }
        case 'up': { const e = E.inCubic(v); op *= 1 - v; ty -= e * 26; break; }
        case 'shrink': { const e = E.inCubic(v); op *= 1 - e; sc *= 1 - 0.14 * e; break; }
        case 'fade': default: op *= 1 - E.outCubic(v); break;
      }
    }
    return { op, tx, ty, sc, sx, blur, clip, text };
  }

  window.renderFrame = function (t) {
    let sig = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.keep) continue;
      const on = t >= it.t0 - EPS && t < it.t1 - EPS;
      if (on !== it.on) { it.el.style.display = on ? '' : 'none'; it.on = on; }
      if (!on) continue;
      let any = it.kids.length === 0;
      let s = '';
      for (let j = 0; j < it.kids.length; j++) {
        const k = it.kids[j];
        const st = styleFor(k, t);
        const key = `${st.op.toFixed(3)}|${st.tx.toFixed(2)}|${st.ty.toFixed(2)}|${st.sc.toFixed(4)}|${st.sx.toFixed(4)}|${st.blur.toFixed(2)}|${st.clip || ''}|${st.text || ''}`;
        if (st.op > 0.001) any = true;
        if (key !== k.last) {
          const e = k.el.style;
          e.opacity = st.op.toFixed(3);
          e.transform = `translate(${st.tx.toFixed(2)}px, ${st.ty.toFixed(2)}px) scale(${(st.sc * st.sx).toFixed(4)}, ${st.sc.toFixed(4)})`;
          e.filter = st.blur > 0.05 ? `blur(${st.blur.toFixed(2)}px) ${k.base}`.trim() : k.base;
          if (st.clip !== null) e.clipPath = st.clip;
          if (st.text !== null && k.el.textContent !== st.text) k.el.textContent = st.text;
          k.last = key;
        }
        if (st.op > 0.001) s += j + ':' + key + ';';
      }
      if (any) sig += '#' + i + '{' + s + '}';
    }
    return sig;
  };
})();
