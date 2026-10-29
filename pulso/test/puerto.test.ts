// Puerto dinámico de la app de escritorio: el servidor con PORT=0 publica el puerto real (`PULSO_PORT=…`)
// y marca sus respuestas de /api/health con la instancia que le pasaron; la app elige 8787 si está libre.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../server/util';

const { pickPort, parsePortLine, PREFERRED_PORT } = createRequire(import.meta.url)('../desktop/port.cjs') as {
  pickPort: (host: string, preferred?: number) => Promise<number>;
  parsePortLine: (line: string) => number | null;
  PREFERRED_PORT: number;
};

const INSTANCE = 'instancia-de-prueba';
let child: ChildProcess;
let dir: string;
let logs = '';
let port = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pulso-puerto-'));
  child = spawn(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATA_PROVIDER: 'demo', HOST: '127.0.0.1', PORT: '0', PULSO_INSTANCE: INSTANCE, PULSO_DATA_DIR: dir, PULSO_CACHE_DIR: dir, ALPACA_KEY_ID: '', ALPACA_SECRET_KEY: '', MASSIVE_API_KEY: '', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout?.on('data', (d) => {
    logs += d;
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const p = parsePortLine(line);
      if (p) port = p;
    }
  });
  child.stderr?.on('data', (d) => (logs += d));
  for (let i = 0; i < 120 && !port; i++) await new Promise((r) => setTimeout(r, 500));
  if (!port) throw new Error(`El servidor no publicó PULSO_PORT:\n${logs}`);
}, 90_000);

afterAll(() => {
  child?.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

describe('puerto dinámico', () => {
  it('con PORT=0 el servidor publica el puerto real y escucha ahí', async () => {
    expect(port).toBeGreaterThan(0);
    expect(logs).toMatch(new RegExp(`escuchando en http://127.0.0.1:${port}`));
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { app: string }).app).toBe('pulso');
  });

  it('/api/health lleva la instancia que le pasó la app (y las demás rutas no)', async () => {
    const h = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(h.headers.get('x-pulso-instance')).toBe(INSTANCE);
    const other = await fetch(`http://127.0.0.1:${port}/api/search?q=a`);
    expect(other.headers.get('x-pulso-instance')).toBeNull();
  });

  it('parsePortLine solo acepta la línea exacta', () => {
    expect(parsePortLine('PULSO_PORT=12345')).toBe(12345);
    expect(parsePortLine('PULSO_PORT=12345\r')).toBe(12345);
    expect(parsePortLine('[12:00:00] PULSO_PORT=12345')).toBeNull();
    expect(parsePortLine('PULSO_PORT=0')).toBeNull();
    expect(parsePortLine('PULSO_PORT=70000')).toBeNull();
    expect(parsePortLine('Pulso escuchando en http://127.0.0.1:8787')).toBeNull();
  });

  it('pickPort prefiere el puerto de siempre y cae a 0 (que elija el sistema) si está ocupado', async () => {
    expect(PREFERRED_PORT).toBe(8787);
    // Un puerto que acabamos de soltar está libre: se elige ese.
    const free = await new Promise<number>((res) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => res(p));
      });
    });
    expect(await pickPort('127.0.0.1', free)).toBe(free);
    // El del servidor de prueba está ocupado: 0.
    expect(await pickPort('127.0.0.1', port)).toBe(0);
  });
});
