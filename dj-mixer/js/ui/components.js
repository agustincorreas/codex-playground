import { clamp } from '../utils.js';

function arcPath(cx, cy, r, a0, a1) {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const p = (a) => { const t = (a - 90) * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function knob({ label = '', min = -1, max = 1, def = 0, value, bipolar = true, action = null, size = 40, fmt = null, onChange = null, cls = '' }) {
  let v = value ?? def;
  const el = document.createElement('div'); el.className = `knob ${cls}`; if (action) el.dataset.action = action;
  const R = size / 2 - 3, c = size / 2;
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path class="knob-track" d="${arcPath(c, c, R, -135, 135)}"/><path class="knob-arc" d=""/><circle class="knob-body" cx="${c}" cy="${c}" r="${R - 5}"/><line class="knob-ind" x1="${c}" y1="${c - R + 8}" x2="${c}" y2="${c - R + 2}"/></svg><span class="knob-label">${label}</span>`;
  const arc = el.querySelector('.knob-arc'), ind = el.querySelector('.knob-ind');
  const render = () => {
    const t = (v - min) / (max - min), ang = -135 + t * 270;
    ind.setAttribute('transform', `rotate(${ang} ${c} ${c})`);
    const from = bipolar ? 0 : -135;
    arc.setAttribute('d', arcPath(c, c, R, Math.min(from, ang), Math.max(from, ang)));
    el.title = (label ? label + ': ' : '') + (fmt ? fmt(v) : v.toFixed(2));
  };
  const api = { el, min, max, def, get value() { return v; }, set(nv, silent = false) { nv = clamp(nv, min, max); if (nv === v) return; v = nv; render(); if (!silent) onChange?.(v); } };
  let sy = 0, sv = 0;
  el.addEventListener('pointerdown', e => { if (e.button !== 0) return; el.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; el.classList.add('active'); e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (!el.hasPointerCapture(e.pointerId)) return; api.set(sv + (sy - e.clientY) / (e.shiftKey ? 700 : 160) * (max - min)); });
  el.addEventListener('pointerup', e => { el.releasePointerCapture(e.pointerId); el.classList.remove('active'); });
  el.addEventListener('dblclick', () => api.set(def));
  el.addEventListener('wheel', e => { e.preventDefault(); api.set(v - Math.sign(e.deltaY) * (max - min) * (e.shiftKey ? 0.005 : 0.025)); }, { passive: false });
  render();
  return api;
}

export function fader({ min = 0, max = 1, def = 1, value, vertical = true, action = null, onChange = null, cls = '', bipolar = false, detent = false, fmt = null, jump = false }) {
  let v = value ?? def;
  const el = document.createElement('div'); el.className = `fader ${vertical ? 'v' : 'h'} ${cls}`; if (action) el.dataset.action = action;
  el.innerHTML = `<div class="fader-track"><div class="fader-center"></div><div class="fader-fill"></div><div class="fader-thumb"></div></div>`;
  const fill = el.querySelector('.fader-fill'), thumb = el.querySelector('.fader-thumb'), track = el.querySelector('.fader-track');
  const render = () => {
    const t = (v - min) / (max - min);
    if (vertical) { thumb.style.bottom = `${t * 100}%`; if (bipolar) { const lo = Math.min(t, 0.5), hi = Math.max(t, 0.5); fill.style.bottom = `${lo * 100}%`; fill.style.height = `${(hi - lo) * 100}%`; } else { fill.style.bottom = 0; fill.style.height = `${t * 100}%`; } }
    else { thumb.style.left = `${t * 100}%`; if (bipolar) { const lo = Math.min(t, 0.5), hi = Math.max(t, 0.5); fill.style.left = `${lo * 100}%`; fill.style.width = `${(hi - lo) * 100}%`; } else { fill.style.left = 0; fill.style.width = `${t * 100}%`; } }
    el.title = fmt ? fmt(v) : v.toFixed(2);
  };
  const api = { el, min, max, def, get value() { return v; }, set(nv, silent = false) { nv = clamp(nv, min, max); if (detent && Math.abs(nv - (min + max) / 2) < (max - min) * 0.012) nv = (min + max) / 2; if (nv === v) return; v = nv; render(); if (!silent) onChange?.(v); } };
  let s0 = 0, sv = 0;
  const pos = (e) => { const r = track.getBoundingClientRect(); return vertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width; };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; el.setPointerCapture(e.pointerId); el.classList.add('active'); e.preventDefault();
    if (jump || e.target === track || e.target === fill) { api.set(min + clamp(pos(e), 0, 1) * (max - min)); }
    s0 = vertical ? e.clientY : e.clientX; sv = v;
  });
  el.addEventListener('pointermove', e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const r = track.getBoundingClientRect(); const len = vertical ? r.height : r.width;
    const d = vertical ? (s0 - e.clientY) : (e.clientX - s0);
    api.set(sv + d / len * (max - min) / (e.shiftKey ? 4 : 1));
  });
  el.addEventListener('pointerup', e => { el.releasePointerCapture(e.pointerId); el.classList.remove('active'); });
  el.addEventListener('dblclick', () => api.set(def));
  el.addEventListener('wheel', e => { e.preventDefault(); api.set(v - Math.sign(e.deltaY) * (max - min) * 0.02); }, { passive: false });
  render();
  return api;
}

export function button({ label, action = null, cls = '', onPress = null, onRelease = null, title = '' }) {
  const el = document.createElement('button'); el.type = 'button'; el.className = `btn ${cls}`; el.innerHTML = label; if (title) el.title = title;
  if (action) el.dataset.action = action;
  let down = false;
  el.addEventListener('pointerdown', e => { if (e.button !== 0) return; down = true; try { el.setPointerCapture(e.pointerId); } catch { /* evento sintético */ } onPress?.(e); });
  el.addEventListener('pointerup', () => { if (down) { down = false; onRelease?.(); } });
  el.addEventListener('pointercancel', () => { if (down) { down = false; onRelease?.(); } });
  el.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); onPress?.(e); } });
  el.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') onRelease?.(); });
  el.addEventListener('contextmenu', e => e.preventDefault());
  return { el, set(on) { el.classList.toggle('on', !!on); } };
}
