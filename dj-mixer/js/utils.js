export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-6));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function fmtTime(s, { neg = false, tenths = true } = {}) {
  if (!isFinite(s)) return '--:--';
  s = Math.max(0, s);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), d = Math.floor((s % 1) * 10);
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${tenths ? '.' + d : ''}`;
}
export const fmtBpm = (b) => (b ? b.toFixed(1) : '--.-');
export const fmtPct = (r) => `${r >= 1 ? '+' : ''}${((r - 1) * 100).toFixed(2)}%`;

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function parseFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

let toastTimer = null;
export function toast(msg, kind = 'info', ms = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), ms);
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
