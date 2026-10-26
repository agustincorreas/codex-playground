// La cuenta de práctica guardada en el servidor (en tu computadora): una sola para todos los
// dispositivos que abran Pulso. Un archivo JSON con el estado de la cuenta y el historial de días; cada
// cambio sube el número de revisión, así los otros dispositivos saben que tienen que volver a leerla.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionRecord, TrainingState } from '../src/trading/types';

export interface AccountFile {
  version: 1;
  /** Sube con cada cambio (0 = nunca se guardó nada). */
  rev: number;
  updatedAt: number;
  state: TrainingState | null;
  sessions: SessionRecord[];
}

const EMPTY: AccountFile = { version: 1, rev: 0, updatedAt: 0, state: null, sessions: [] };

export function isTrainingState(v: unknown): v is TrainingState {
  const s = v as Partial<TrainingState> | null;
  return !!s && typeof s === 'object' && s.version === 1 && typeof s.balance === 'number' && typeof s.settings === 'object';
}

export function isSessionRecord(v: unknown): v is SessionRecord {
  const s = v as Partial<SessionRecord> | null;
  return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.endedAt === 'number' && Array.isArray(s.trades);
}

export class AccountStore {
  private data: AccountFile;

  constructor(readonly path: string) {
    this.data = this.read();
  }

  /** Lee el archivo; si está roto, prueba con la copia anterior (`.bak`); si no hay nada, cuenta vacía. */
  private read(): AccountFile {
    for (const file of [this.path, `${this.path}.bak`]) {
      try {
        if (!existsSync(file)) continue;
        const d = JSON.parse(readFileSync(file, 'utf8')) as Partial<AccountFile>;
        if (d && d.version === 1 && Array.isArray(d.sessions)) {
          return { version: 1, rev: Number(d.rev) || 0, updatedAt: Number(d.updatedAt) || 0, state: isTrainingState(d.state) ? d.state : null, sessions: d.sessions.filter(isSessionRecord) };
        }
      } catch {
        // Archivo ilegible: se prueba el siguiente.
      }
    }
    return structuredClone(EMPTY);
  }

  get rev(): number {
    return this.data.rev;
  }

  snapshot(): AccountFile {
    return this.data;
  }

  saveState(state: TrainingState): number {
    this.data.state = state;
    return this.commit();
  }

  /** Agrega o reemplaza un día del historial (los más nuevos primero). */
  saveSession(rec: SessionRecord): number {
    this.data.sessions = [rec, ...this.data.sessions.filter((s) => s.id !== rec.id)].sort((a, b) => b.endedAt - a.endedAt);
    return this.commit();
  }

  clear(): number {
    this.data.state = null;
    this.data.sessions = [];
    return this.commit();
  }

  /** Escribe a un archivo temporal y lo renombra: nunca queda un archivo a medias. Guarda la versión anterior. */
  private commit(): number {
    this.data.rev += 1;
    this.data.updatedAt = Date.now();
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    if (existsSync(this.path)) copyFileSync(this.path, `${this.path}.bak`);
    renameSync(tmp, this.path);
    return this.data.rev;
  }
}
