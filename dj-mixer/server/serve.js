// Servidor estático + "bridge" opcional para YouTube (usa yt-dlp si está instalado).
// Sin dependencias: node server/serve.js  →  http://localhost:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const YTDLP = process.env.YTDLP || 'yt-dlp';
export const SERVER_VERSION = 5; // subir cuando cambie la API del bridge
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.flac': 'audio/flac',
};

// Config persistente (cookies del navegador para la cuenta de YouTube)
const CFG_PATH = path.join(ROOT, 'server', '.config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch { cfg = {}; }
const saveCfg = () => fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
const ytArgs = () => { const a = []; if (cfg.cookiesFromBrowser) a.push('--cookies-from-browser', cfg.cookiesFromBrowser); if (cfg.cookiesFile) a.push('--cookies', cfg.cookiesFile); return a; };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
const cache = new Map(); // key → { at, data }
const cached = async (key, ttlMs, fn) => { const c = cache.get(key); if (c && Date.now() - c.at < ttlMs) return c.data; const data = await fn(); cache.set(key, { at: Date.now(), data }); return data; };

let ytdlpOk = false, ffmpegOk = false;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
execFile(FFMPEG, ['-version'], (err) => { ffmpegOk = !err; if (!ffmpegOk) console.log('ffmpeg no encontrado: sin conversión a WAV de respaldo (opcional).'); });
const cleanErr = (txt) => (String(txt || '').split('\n').map(l => l.trim()).filter(l => /ERROR/i.test(l)).pop() || String(txt || '').trim().split('\n').pop() || '').replace(/^ERROR:\s*/i, '').slice(0, 300);
execFile(YTDLP, ['--version'], (err, out) => {
  ytdlpOk = !err;
  console.log(ytdlpOk ? `yt-dlp ${out.trim()} detectado: bridge de YouTube activo` : 'yt-dlp no encontrado: YouTube funcionará en modo embed (sin waveform/EQ). Instalá yt-dlp para audio completo.');
});

const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); };
// Las llamadas con cookies se serializan: en Mac cada proceso puede disparar el aviso del llavero.
let cookieQueue = Promise.resolve();
const runJson = (args, { cookies = false, timeout = 60000 } = {}) => {
  const run = () => new Promise((resolve, reject) => {
    execFile(YTDLP, [...(cookies ? ytArgs() : []), ...args], { maxBuffer: 32 * 1024 * 1024, timeout }, (err, out) => {
      if (err && !out) return reject(err);
      const items = out.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      resolve(items);
    });
  });
  if (!cookies) return run();
  const p = cookieQueue.then(run, run); cookieQueue = p.catch(() => {}); return p;
};
const cookieError = (e) => {
  const msg = String(e.message || e);
  const browser = cfg.cookiesFromBrowser ? cfg.cookiesFromBrowser[0].toUpperCase() + cfg.cookiesFromBrowser.slice(1) : 'el archivo de cookies';
  if (/keychain|Safe Storage|could not copy|Could not find|cookie database|decrypt|Permission denied|Operation not permitted/i.test(msg))
    return `No se pudo leer la sesión de YouTube desde ${browser}. En Mac, el aviso del llavero pide la contraseña de tu usuario de Mac (la del login, no la de Google): escribila y elegí "Always Allow". Si Chrome está abierto y sigue fallando, cerralo y probá de nuevo, o exportá un cookies.txt y poné la ruta en Ajustes.`;
  if (/sign in|login|bot|cookies are no longer valid|not logged in/i.test(msg))
    return `YouTube no aceptó la sesión leída de ${browser}: iniciá sesión en YouTube en ese navegador y volvé a intentar, o exportá un cookies.txt.`;
  return (msg.split('\n').find(l => /ERROR/.test(l)) || msg).slice(0, 300);
};
// Probar las cookies con una sola llamada (dispara el aviso del llavero una vez)
const probeCookies = async () => {
  if (!cfg.cookiesFromBrowser && !cfg.cookiesFile) return { ok: false, error: 'sin cuenta' };
  try { await runJson(['-j', '--flat-playlist', '--no-warnings', '--playlist-end', '1', ':ytfav'], { cookies: true, timeout: 120000 }); cfg.cookiesOk = true; saveCfg(); return { ok: true }; }
  catch (e) { cfg.cookiesOk = false; saveCfg(); return { ok: false, error: cookieError(e) }; }
};
const pick = (i) => ({
  id: i.id, title: i.title || i.id, artist: i.uploader || i.channel || i.artist || '',
  duration: i.duration || null, url: i.webpage_url || i.url || `https://www.youtube.com/watch?v=${i.id}`,
  thumb: i.thumbnail || (i.thumbnails && i.thumbnails.at(-1) && i.thumbnails.at(-1).url) || null,
});

// Elegir el resultado de YouTube que mejor coincide con un tema (artista, título, duración).
const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function pickMatch(items, { artist = '', title = '', duration = null }) {
  const want = norm(`${artist} ${title}`), wantTitle = norm(title), wantWords = new Set(want.split(' ').filter(Boolean));
  const BAD = ['live', 'cover', 'karaoke', 'remix', 'sped up', 'slowed', 'nightcore', 'reaction', 'instrumental', '8d', 'lyrics video'];
  let best = null, bestScore = -Infinity;
  for (const i of items) {
    const t = norm(i.title), ch = norm(i.artist);
    if (!t) continue;
    const words = new Set(`${t} ${ch}`.split(' '));
    let overlap = 0; for (const w of wantWords) if (words.has(w)) overlap++;
    let score = overlap / Math.max(1, wantWords.size) * 10;
    if (t.includes(wantTitle)) score += 3;
    if (duration && i.duration) { const d = Math.abs(i.duration - duration); score += d <= 3 ? 5 : d <= 10 ? 2 : d <= 30 ? -2 : -8; }
    if (/official audio|topic|provided to youtube|audio/.test(`${t} ${ch}`)) score += 1.5;
    for (const b of BAD) if (`${t} ${ch}`.includes(b) && !want.includes(b)) score -= 4;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best && bestScore >= 4 ? { ...best, score: Math.round(bestScore * 10) / 10 } : null;
}

export function createServer() {
return http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (u.pathname === '/api/bridge/status') return json(res, 200, { ok: true, ytdlp: ytdlpOk, version: SERVER_VERSION, account: !!(cfg.cookiesFromBrowser || cfg.cookiesFile), accountOk: !!cfg.cookiesOk });
    if (u.pathname === '/api/config') {
      let probe = null;
      if (req.method === 'POST') {
        const b = await readBody(req); cfg.cookiesFromBrowser = String(b.cookiesFromBrowser || '').trim(); cfg.cookiesFile = String(b.cookiesFile || '').trim(); cfg.cookiesOk = false; saveCfg(); cache.clear();
        if (cfg.cookiesFromBrowser || cfg.cookiesFile) probe = await probeCookies();
      }
      return json(res, 200, { cookiesFromBrowser: cfg.cookiesFromBrowser || '', cookiesFile: cfg.cookiesFile || '', cookiesOk: !!cfg.cookiesOk, probe });
    }
    // Inicio de YouTube: secciones de la cuenta (con cookies), tendencias de música y relacionados
    if (u.pathname === '/api/yt/home') {
      const section = u.searchParams.get('section') || '', q = u.searchParams.get('q') || '';
      if (!ytdlpOk) return json(res, 503, { error: 'yt-dlp no disponible' });
      const ACCOUNT = { rec: ':ytrec', history: ':ythistory', liked: ':ytfav', later: ':ytwatchlater', subs: ':ytsubs' };
      let target = null, needsAccount = false;
      if (ACCOUNT[section]) { target = ACCOUNT[section]; needsAccount = true; }
      else if (section === 'trending') target = 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D';
      else if (section === 'related' && q) target = `ytsearch8:${q} official audio`;
      else return json(res, 400, { error: 'section inválida' });
      if (needsAccount && !cfg.cookiesFromBrowser && !cfg.cookiesFile) return json(res, 200, { items: [], needsAccount: true });
      try {
        const items = await cached(`${section}:${q}`, 5 * 60 * 1000, async () => {
          const raw = await runJson(['-j', '--flat-playlist', '--no-warnings', '--playlist-end', '24', target], { cookies: needsAccount, timeout: needsAccount ? 120000 : 60000 });
          return raw.map(pick).filter(i => i.id && (!i.duration || i.duration <= 20 * 60));
        });
        if (needsAccount) { cfg.cookiesOk = true; }
        return json(res, 200, { items });
      } catch (e) {
        return json(res, 200, { items: [], error: needsAccount ? cookieError(e) : (String(e.message || e).split('\n').find(l => /ERROR/.test(l)) || 'yt-dlp falló').slice(0, 300) });
      }
    }
    if (u.pathname === '/api/resolve') {
      const url = u.searchParams.get('url'); if (!url) return json(res, 400, { error: 'url requerida' });
      if (!ytdlpOk) return json(res, 503, { error: 'yt-dlp no disponible' });
      const [info] = await runJson(['-j', '--no-playlist', '--no-warnings', url]);
      if (!info) return json(res, 404, { error: 'no encontrado' });
      return json(res, 200, pick(info));
    }
    if (u.pathname === '/api/search') {
      const q = u.searchParams.get('q'); if (!q) return json(res, 400, { error: 'q requerida' });
      if (!ytdlpOk) return json(res, 503, { error: 'yt-dlp no disponible' });
      const items = await runJson(['-j', '--flat-playlist', '--no-warnings', `ytsearch10:${q}`]);
      return json(res, 200, items.map(pick));
    }
    if (u.pathname === '/api/match') {
      const artist = u.searchParams.get('artist') || '', title = u.searchParams.get('title') || '', duration = Number(u.searchParams.get('duration')) || null;
      if (!title) return json(res, 400, { error: 'title requerido' });
      if (!ytdlpOk) return json(res, 503, { error: 'yt-dlp no disponible' });
      // varias consultas, de más específica a más general
      const firstArtist = artist.split(/,|&| feat\.? | ft\.? /i)[0].trim();
      const cleanTitle = title.replace(/\s*[-–]\s*.*(remix|mix|edit|version|remaster).*$/i, (m) => ' ' + m.replace(/^[\s-–]+/, '')).trim();
      const queries = [...new Set([`${artist} ${title}`, `${firstArtist} ${title}`, `${firstArtist} ${cleanTitle}`, title].map(q => q.trim()).filter(Boolean))];
      let m = null, tried = 0;
      for (const q of queries) {
        const items = await runJson(['-j', '--flat-playlist', '--no-warnings', `ytsearch8:${q}`]).catch(() => []);
        tried++;
        m = pickMatch(items.map(pick), { artist: firstArtist, title, duration });
        if (m) { m.query = q; break; }
      }
      return json(res, 200, m || { error: 'sin coincidencia', tried });
    }
    if (u.pathname === '/api/stream') {
      const url = u.searchParams.get('url'); if (!url) return json(res, 400, { error: 'url requerida' });
      if (!ytdlpOk) return json(res, 503, { error: 'yt-dlp no disponible' });
      const wantWav = u.searchParams.get('fmt') === 'wav';
      const p = spawn(YTDLP, [...(cfg.cookiesOk ? ytArgs() : []), '-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', '--no-warnings', '-q', '-o', '-', url]);
      let err = '', started = false, ff = null, out = p.stdout;
      p.stderr.on('data', d => { err += d; });
      if (wantWav) {
        if (!ffmpegOk) { p.kill('SIGKILL'); return json(res, 503, { error: 'ffmpeg no está instalado: no se puede convertir el audio (brew install ffmpeg / apt install ffmpeg).' }); }
        ff = spawn(FFMPEG, ['-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '2', '-ar', '44100', '-f', 'wav', 'pipe:1']);
        ff.stderr.on('data', d => { err += d; });
        p.stdout.pipe(ff.stdin); ff.stdin.on('error', () => {});
        out = ff.stdout;
      }
      const fail = (msg) => { if (!started && !res.headersSent) json(res, 502, { error: msg }); };
      out.once('data', (chunk) => {
        started = true;
        res.writeHead(200, { 'Content-Type': wantWav ? 'audio/wav' : 'audio/mp4', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        res.write(chunk); out.pipe(res);
      });
      out.on('end', () => fail(cleanErr(err) || 'yt-dlp no devolvió audio para este video'));
      p.on('error', e => fail(e.message));
      ff?.on('error', e => fail('ffmpeg: ' + e.message));
      req.on('close', () => { p.kill('SIGKILL'); ff?.kill('SIGKILL'); });
      return;
    }
    // estático
    let file = path.normalize(decodeURIComponent(u.pathname));
    if (file.endsWith('/')) file += 'index.html';
    const abs = path.join(ROOT, file);
    if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.stat(abs, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(abs).pipe(res);
    });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srv = createServer();
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nEl puerto ${PORT} ya está en uso: hay otro servidor MIXR corriendo (probablemente una versión vieja).`);
      console.error(`Cortalo con Ctrl+C en su terminal, o buscá el proceso con:  lsof -i :${PORT}   y matalo con:  kill -9 <PID>`);
      console.error(`También podés usar otro puerto:  PORT=8788 npm start\n`);
      process.exit(1);
    }
    throw e;
  });
  srv.listen(PORT, () => console.log(`MIXR DJ v${SERVER_VERSION} → http://127.0.0.1:${PORT}  (usá 127.0.0.1 y no localhost si vas a conectar Spotify)`));
}
