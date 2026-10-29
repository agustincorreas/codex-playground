// El servidor entero, arrancado en modo demo en un puerto libre con token: permisos desde la red, mismo
// origen, rutas raras, cuerpos enormes, revisión de la cuenta y frames de WebSocket rotos.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../server/util';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const TOKEN = 'tokenprueba';
/** Una dirección de esta máquina que no sea loopback (si no hay, las pruebas "desde la red" se saltean). */
const LAN = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const local = `http://127.0.0.1:${PORT}`;
const lan = LAN ? `http://${LAN}:${PORT}` : null;

let child: ChildProcess;
let dir: string;
let logs = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pulso-server-'));
  child = spawn(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATA_PROVIDER: 'demo', HOST: '0.0.0.0', PORT: String(PORT), PULSO_TOKEN: TOKEN, PULSO_DATA_DIR: dir, PULSO_CACHE_DIR: dir, ALPACA_KEY_ID: '', ALPACA_SECRET_KEY: '', MASSIVE_API_KEY: '', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (logs += d));
  child.stderr?.on('data', (d) => (logs += d));
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await fetch(`${local}/api/health`)).ok) return;
    } catch {
      // Todavía no escucha.
    }
  }
  throw new Error(`El servidor no arrancó:\n${logs}`);
}, 90_000);

afterAll(() => {
  child?.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

const status = async (url: string, init?: RequestInit) => (await fetch(url, init)).status;
const put = (url: string, body: BodyInit, headers: Record<string, string> = {}) => fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'application/json', ...headers } });

describe('servidor', () => {
  it('deja entrar a la propia computadora sin token y a la red solo con el token', async () => {
    expect(await status(`${local}/api/health`)).toBe(200);
    if (!lan) return;
    expect(await status(`${lan}/api/health`)).toBe(403);
    expect(await status(`${lan}/`)).toBe(403);
    expect(await status(`${lan}/api/health?t=${TOKEN}`)).toBe(200);
    expect(await status(`${lan}/api/health`, { headers: { Authorization: `Bearer ${TOKEN}` } })).toBe(200);
    const page = await fetch(`${lan}/?t=${TOKEN}`);
    expect(page.status).not.toBe(403);
    expect(page.headers.get('set-cookie')).toContain('pulso_t=');
    expect(await status(`${lan}/api/health`, { headers: { Cookie: `pulso_t=${TOKEN}` } })).toBe(200);
    expect(await status(`${lan}/api/health`, { headers: { Cookie: 'pulso_t=otro' } })).toBe(403);
  });

  it('rechaza otro origen (una página ajena abierta en el navegador)', async () => {
    expect(await status(`${local}/api/health`, { headers: { Origin: 'http://ajeno.example' } })).toBe(403);
    expect(await status(`${local}/api/health`, { headers: { Origin: `http://127.0.0.1:${PORT}` } })).toBe(200);
  });

  it('no se cae con direcciones raras ni se escapa de dist', async () => {
    expect(await status(`${local}/%`)).toBe(400);
    const raw = await new Promise<string>((res) => {
      const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET /../package.json HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`));
      let out = '';
      s.on('data', (d) => (out += d));
      s.on('close', () => res(out));
      s.on('error', () => res(out));
    });
    expect(raw).not.toContain('"name": "pulso');
    expect(await status(`${local}/api/nada`)).toBe(404);
    expect(await status(`${local}/api/health`)).toBe(200);
  });

  it('limita el cuerpo por ruta y responde 413 sin caerse', async () => {
    const res = await put(`${local}/api/account/state`, Buffer.alloc(17 * 1024 * 1024, 32)).catch((e: Error) => e);
    // fetch puede ver el 413 o un corte de conexión (el servidor cierra sin leer los 17 MB): las dos valen.
    if (res instanceof Response) expect(res.status).toBe(413);
    const chunked = await new Promise<string>((res) => {
      const s = net.connect(PORT, '127.0.0.1', () => {
        s.write(`PUT /api/account/state HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`);
        const piece = Buffer.alloc(1024 * 1024, 32);
        const chunk = Buffer.concat([Buffer.from(piece.length.toString(16) + '\r\n'), piece, Buffer.from('\r\n')]);
        for (let i = 0; i < 20; i++) s.write(chunk);
      });
      let out = '';
      s.on('data', (d) => (out += d));
      s.on('close', () => res(out));
      s.on('error', () => res(out));
      setTimeout(() => s.destroy(), 5000);
    });
    expect(chunked.slice(0, 20)).toContain('413');
    expect(await status(`${local}/api/health`)).toBe(200);
    expect((await put(`${local}/api/account/state`, '{')).status).toBe(400);
    expect((await fetch(`${local}/api/ai`, { method: 'POST', body: '{"prompt":"hola"}' })).status).toBe(503);
  });

  it('guarda la cuenta y avisa con 409 cuando otro dispositivo guardó antes', async () => {
    const state = { version: 1, balance: 1000, settings: {}, updatedAt: Date.now() };
    const first = await put(`${local}/api/account/state`, JSON.stringify(state));
    expect(first.status).toBe(200);
    const { rev } = (await first.json()) as { rev: number };
    expect(rev).toBeGreaterThan(0);
    const stale = await put(`${local}/api/account/state`, JSON.stringify(state), { 'If-Match': String(rev - 1) });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { rev: number }).rev).toBe(rev);
    const fresh = await put(`${local}/api/account/state`, JSON.stringify(state), { 'If-Match': String(rev) });
    expect(fresh.status).toBe(200);
    expect(((await fresh.json()) as { rev: number }).rev).toBe(rev + 1);
  });

  it('WebSocket: token desde la red y un frame roto no tiran el servidor', async () => {
    const open = (url: string) =>
      new Promise<boolean>((res) => {
        const w = new WebSocket(url);
        w.on('open', () => (w.close(), res(true)));
        w.on('error', () => res(false));
        w.on('unexpected-response', () => res(false));
      });
    expect(await open(`ws://127.0.0.1:${PORT}/ws`)).toBe(true);
    if (lan) {
      expect(await open(`ws://${LAN}:${PORT}/ws`)).toBe(false);
      expect(await open(`ws://${LAN}:${PORT}/ws?t=${TOKEN}`)).toBe(true);
    }
    await new Promise<void>((res) => {
      const s = net.connect(PORT, '127.0.0.1', () => {
        s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        setTimeout(() => {
          // Frame de texto enmascarado con bytes que no son UTF-8 válido.
          s.write(Buffer.from([0x81, 0x82, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfe]));
          setTimeout(() => (s.destroy(), res()), 300);
        }, 300);
      });
      s.on('error', () => res());
    });
    expect(await status(`${local}/api/health`)).toBe(200);
  });
});
