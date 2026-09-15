// Servidor estático + "bridge" opcional para YouTube (usa yt-dlp si está instalado).
// Sin dependencias: node server/serve.js  →  http://localhost:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const YTDLP = process.env.YTDLP || 'yt-dlp';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.flac': 'audio/flac',
};

let ytdlpOk = false;
execFile(YTDLP, ['--version'], (err, out) => {
  ytdlpOk = !err;
  console.log(ytdlpOk ? `yt-dlp ${out.trim()} detectado: bridge de YouTube activo` : 'yt-dlp no encontrado: YouTube funcionará en modo embed (sin waveform/EQ). Instalá yt-dlp para audio completo.');
});

const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); };
const runJson = (args) => new Promise((resolve, reject) => {
  execFile(YTDLP, args, { maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
    if (err) return reject(err);
    const items = out.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    resolve(items);
  });
});
const pick = (i) => ({
  id: i.id, title: i.title || i.id, artist: i.uploader || i.channel || i.artist || '',
  duration: i.duration || null, url: i.webpage_url || i.url || `https://www.youtube.com/watch?v=${i.id}`,
  thumb: i.thumbnail || (i.thumbnails && i.thumbnails.at(-1) && i.thumbnails.at(-1).url) || null,
});

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (u.pathname === '/api/bridge/status') return json(res, 200, { ok: true, ytdlp: ytdlpOk });
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
    if (u.pathname === '/api/stream') {
      const url = u.searchParams.get('url'); if (!url) return json(res, 400, { error: 'url requerida' });
      if (!ytdlpOk) return json(res, 503, { error: 'yt-dlp no disponible' });
      res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      const p = spawn(YTDLP, ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-warnings', '-q', '-o', '-', url]);
      p.stdout.pipe(res);
      p.stderr.on('data', d => process.stderr.write(d));
      req.on('close', () => p.kill('SIGKILL'));
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
}).listen(PORT, () => console.log(`MIXR DJ → http://127.0.0.1:${PORT}  (usá 127.0.0.1 y no localhost si vas a conectar Spotify)`));
