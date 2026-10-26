// La cuenta de práctica guardada en el servidor: archivo, revisión, copia anterior y validación.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccountStore, isSessionRecord, isTrainingState } from '../server/account';
import type { SessionRecord, TrainingState } from '../src/trading/types';

const state = (balance: number): TrainingState =>
  ({ version: 1, settings: { startingBalance: 10_000 } as unknown as TrainingState['settings'], balance, dayIndex: 1, priorDayTrades: [], updatedAt: 1 }) as unknown as TrainingState;
const session = (id: string, endedAt: number): SessionRecord => ({ id, mode: 'live', dayKey: '2026-10-26', dayIndex: 1, startedAt: endedAt - 1000, endedAt, startCash: 10_000, endCash: 10_100, trades: [] }) as unknown as SessionRecord;

describe('AccountStore', () => {
  it('guarda estado y días, sube la revisión y vuelve a leer lo mismo desde el disco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-cuenta-'));
    const path = join(dir, 'sub', 'cuenta.json');
    const a = new AccountStore(path);
    expect(a.rev).toBe(0);
    expect(a.saveState(state(10_000))).toBe(1);
    expect(a.saveSession(session('d1', 100))).toBe(2);
    expect(a.saveSession(session('d2', 200))).toBe(3);
    // Reemplaza por id y ordena del más nuevo al más viejo.
    a.saveSession({ ...session('d1', 100), endCash: 9_000 } as SessionRecord);
    const b = new AccountStore(path);
    expect(b.rev).toBe(4);
    expect(b.snapshot().state?.balance).toBe(10_000);
    expect(b.snapshot().sessions.map((s) => s.id)).toEqual(['d2', 'd1']);
    expect((b.snapshot().sessions[1] as unknown as { endCash: number }).endCash).toBe(9_000);
    expect(b.clear()).toBe(5);
    expect(new AccountStore(path).snapshot()).toMatchObject({ rev: 5, state: null, sessions: [] });
  });

  it('si el archivo se rompe, usa la copia anterior', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulso-cuenta-'));
    const path = join(dir, 'cuenta.json');
    const a = new AccountStore(path);
    a.saveState(state(5_000));
    a.saveState(state(6_000));
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8')).state.balance).toBe(5_000);
    writeFileSync(path, '{"version":1,"rev":2,"sta');
    expect(new AccountStore(path).snapshot().state?.balance).toBe(5_000);
  });

  it('valida lo que llega del navegador', () => {
    expect(isTrainingState(state(1))).toBe(true);
    expect(isTrainingState({ version: 2 })).toBe(false);
    expect(isTrainingState(null)).toBe(false);
    expect(isSessionRecord(session('x', 1))).toBe(true);
    expect(isSessionRecord({ id: 'x' })).toBe(false);
  });
});
