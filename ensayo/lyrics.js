// lyrics.js — letra sincronizada desde LRCLIB (API abierta, sin key).
// Devuelve texto compatible con el cifrado de Ensayo: una línea por verso con
// [mm:ss.xx] al inicio (formato LRC), o letra sin tiempos si solo hay plana.
(function () {
  'use strict';
  const BASE = 'https://lrclib.net/api';

  function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  async function getJson(url) {
    const r = await fetch(url, { headers: { 'Lrclib-Client': 'Ensayo (https://agustincorreas.github.io/codex-playground/ensayo/)' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('LRCLIB ' + r.status);
    return r.json();
  }

  /** Busca la letra. Devuelve { status: 'synced'|'plain'|'notfound', chart, source } */
  async function fetchLyrics(title, artist, durationSec) {
    const q = new URLSearchParams({ track_name: title, artist_name: artist || '' });
    if (durationSec) q.set('duration', Math.round(durationSec));
    let rec = null;
    try { rec = await getJson(`${BASE}/get?${q}`); } catch (e) { /* seguimos con search */ }
    if (!rec || (!rec.syncedLyrics && !rec.plainLyrics)) {
      const sq = new URLSearchParams({ track_name: title });
      if (artist) sq.set('artist_name', artist);
      let list = [];
      try { list = await getJson(`${BASE}/search?${sq}`) || []; } catch (e) { list = []; }
      if (!list.length) { try { list = await getJson(`${BASE}/search?q=${encodeURIComponent(title + ' ' + (artist || ''))}`) || []; } catch (e) { list = []; } }
      const nt = norm(title), na = norm(artist);
      const score = (x) => (x.syncedLyrics ? 10 : 0) + (norm(x.trackName) === nt ? 5 : norm(x.trackName).includes(nt) ? 2 : 0) + (na && norm(x.artistName).includes(na) ? 4 : 0) - (x.instrumental ? 20 : 0);
      list.sort((a, b) => score(b) - score(a));
      rec = list.find(x => x.syncedLyrics || x.plainLyrics) || null;
    }
    if (!rec) return { status: 'notfound', chart: '' };
    if (rec.syncedLyrics) return { status: 'synced', chart: lrcToChart(rec.syncedLyrics), source: rec, duration: rec.duration };
    return { status: 'plain', chart: rec.plainLyrics.trim(), source: rec, duration: rec.duration };
  }

  /** LRC → líneas [m:ss.xx] texto. Quita metadatos ([ar:], [ti:]…) y líneas vacías repetidas. */
  function lrcToChart(lrc) {
    const out = [];
    for (const raw of lrc.replace(/\r\n?/g, '\n').split('\n')) {
      const m = /^\s*\[(\d+):(\d{1,2}(?:\.\d+)?)\]\s*(.*)$/.exec(raw);
      if (!m) { if (/^\s*\[[a-z]+:/i.test(raw)) continue; if (raw.trim()) out.push(raw.trim()); continue; }
      const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
      const text = m[3].replace(/\[[^\]]*\]/g, '').trim(); // por si viene con acordes/anotaciones entre corchetes
      const mm = Math.floor(t / 60), ss = t - mm * 60;
      out.push(`[${mm}:${ss < 10 ? '0' : ''}${ss.toFixed(2)}] ${text || '♪'}`);
    }
    return out.join('\n');
  }

  window.Lyrics = { fetchLyrics, lrcToChart };
})();
