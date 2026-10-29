// La cuenta en el servidor de Pulso: el estado va con `If-Match: rev`; ante un 409 se reintenta una vez
// si lo de acá es más nuevo, y si no, la página toma la cuenta del servidor (`onConflict`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerTrainingStore } from '../src/trading/store';
import { DEFAULT_TRADING, type SessionRecord, type TrainingState } from '../src/trading/types';

const state = (updatedAt: number, balance = 1000): TrainingState => ({ version: 1, settings: DEFAULT_TRADING, balance, dayIndex: 1, dayTrades: [], updatedAt });
const day = (id: string): SessionRecord => ({ id, mode: 'sim', dayKey: '2026-10-23', startedAt: 1, endedAt: 2, marketStart: 1, marketEnd: 2, startCash: 1000, endCash: 1010, trades: [] });

interface Call {
  path: string;
  method: string;
  ifMatch?: string;
  body?: unknown;
}

/** Servidor falso: lleva la revisión y responde 409 (con su cuenta) cuando el If-Match no coincide. */
function fakeServer(opts: { rev?: number; state?: TrainingState | null } = {}) {
  const srv = { rev: opts.rev ?? 5, state: opts.state ?? null, sessions: [] as SessionRecord[], calls: [] as Call[], down: 0 };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    srv.calls.push({ path, method: init?.method ?? 'GET', ifMatch: headers['If-Match'], body });
    if (srv.down > 0) {
      srv.down--;
      throw new TypeError('fetch failed');
    }
    if (path === '/api/account' && init?.method === 'GET') return json(200, { rev: srv.rev, state: srv.state, sessions: srv.sessions });
    if (path === '/api/account/state') {
      if (headers['If-Match'] !== String(srv.rev)) return json(409, { rev: srv.rev, state: srv.state, sessions: srv.sessions });
      srv.state = body as TrainingState;
      return json(200, { rev: ++srv.rev });
    }
    if (path === '/api/account/session') {
      srv.sessions = [body as SessionRecord, ...srv.sessions.filter((s) => s.id !== (body as SessionRecord).id)];
      return json(200, { rev: ++srv.rev });
    }
    return json(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return srv;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cuenta en el servidor de Pulso', () => {
  it('manda If-Match con la última revisión y toma la nueva al guardar', async () => {
    const srv = fakeServer({ rev: 5, state: state(1) });
    const store = new ServerTrainingStore();
    await store.load();
    expect(store.rev).toBe(5);
    await store.saveState(state(2));
    expect(srv.calls.at(-1)).toMatchObject({ path: '/api/account/state', method: 'PUT', ifMatch: '5' });
    expect(store.rev).toBe(6);
    // Los días no llevan If-Match (se fusionan por id).
    await store.saveSession(day('d1'));
    expect(srv.calls.at(-1)).toMatchObject({ path: '/api/account/session', ifMatch: undefined });
    expect(store.rev).toBe(7);
  });

  it('409 con la cuenta de acá más nueva: reintenta una vez con la revisión nueva', async () => {
    const srv = fakeServer({ rev: 5, state: state(1) });
    const store = new ServerTrainingStore();
    const conflicts: unknown[] = [];
    store.onConflict = (s) => conflicts.push(s);
    await store.load();
    // Otro dispositivo escribió mientras tanto.
    srv.rev = 8;
    srv.state = state(10, 1500);
    await store.saveState(state(20, 2000));
    const puts = srv.calls.filter((c) => c.path === '/api/account/state');
    expect(puts.map((c) => c.ifMatch)).toEqual(['5', '8']);
    expect(srv.state!.balance).toBe(2000);
    expect(store.rev).toBe(9);
    expect(conflicts).toHaveLength(0);
  });

  it('409 con la cuenta del servidor más nueva: no insiste y avisa para que la página la reemplace', async () => {
    const srv = fakeServer({ rev: 5, state: state(1) });
    const store = new ServerTrainingStore();
    const conflicts: Array<{ state: TrainingState | null; sessions: SessionRecord[] }> = [];
    store.onConflict = (s) => conflicts.push(s);
    await store.load();
    srv.rev = 8;
    srv.state = state(30, 1500);
    srv.sessions = [day('d9')];
    await store.saveState(state(20, 2000));
    expect(srv.calls.filter((c) => c.path === '/api/account/state')).toHaveLength(1);
    expect(srv.state!.balance).toBe(1500);
    expect(store.rev).toBe(8);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].state!.balance).toBe(1500);
    expect(conflicts[0].sessions.map((s) => s.id)).toEqual(['d9']);
  });

  it('si choca dos veces seguidas, gana el servidor', async () => {
    const srv = fakeServer({ rev: 5, state: state(1) });
    const store = new ServerTrainingStore();
    const conflicts: unknown[] = [];
    store.onConflict = (s) => conflicts.push(s);
    await store.load();
    // Cada vez que llega el PUT, el servidor ya cambió de nuevo.
    const original = fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/account/state') srv.rev++;
      return original(input, init);
    });
    await store.saveState(state(99));
    expect(srv.calls.filter((c) => c.path === '/api/account/state')).toHaveLength(2);
    expect(conflicts).toHaveLength(1);
  });

  it('si el servidor no responde, reintenta y después guarda en el navegador y avisa; flush espera las escrituras', async () => {
    const srv = fakeServer({ rev: 5, state: state(1) });
    const store = new ServerTrainingStore();
    let fallback = 0;
    store.onFallback = () => fallback++;
    await store.load();
    srv.down = 2;
    const p = store.saveState(state(2));
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(fallback).toBe(1);
    expect(srv.calls.filter((c) => c.path === '/api/account/state')).toHaveLength(2);
    let done = false;
    const w = store.saveState(state(3)).then(() => (done = true));
    await store.flush();
    await w;
    expect(done).toBe(true);
    expect(store.rev).toBe(6);
  });
});
