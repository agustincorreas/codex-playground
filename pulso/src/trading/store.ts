// Dónde se guarda la cuenta de práctica: en la base del artifact (por persona, privada) cuando la página
// corre dentro de Claude, o en el navegador (localStorage) cuando corre suelta o en tu computadora.
import type { ActiveSession, SessionRecord, Trade, TrainingState } from './types';

export interface TrainingStore {
  /** 'cuenta' = base de datos de Claude (sigue en otros dispositivos); 'navegador' = este navegador. */
  readonly kind: 'cuenta' | 'navegador';
  /** Avisa cuando la cuenta de Claude deja de aceptar escrituras y se pasa a guardar en el navegador. */
  onFallback?: () => void;
  load(): Promise<{ state: TrainingState | null; sessions: SessionRecord[] }>;
  saveState(state: TrainingState): Promise<void>;
  saveSession(rec: SessionRecord): Promise<void>;
  clear(): Promise<void>;
}

/** Tamaño máximo de un documento (la base acepta 256 KiB; se deja margen). */
const MAX_DOC = 220_000;

/** Bytes del JSON en UTF-8: el límite de la base es en bytes, no en caracteres. */
export function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/** Quita las velas y después las marcas de los trades más viejos hasta que `total` baje de `max`. */
function trimTrades(trades: Trade[], total: number, max: number): number {
  for (const key of ['bars', 'marks'] as const) {
    for (let i = 0; i < trades.length && total > max; i++) {
      const v = trades[i][key];
      if (v === undefined) continue;
      // `"bars":` más la coma que lo separa del campo vecino.
      total -= jsonBytes(v) + key.length + 4;
      const t = { ...trades[i] };
      delete t[key];
      trades[i] = t;
    }
  }
  return total;
}

/** Si una sesión con muchos trades no entra en un documento, se quitan las velas de los más viejos. */
export function fitSession(rec: SessionRecord, max = MAX_DOC): SessionRecord {
  const total = jsonBytes(rec);
  if (total <= max) return rec;
  const copy: SessionRecord = { ...rec, trades: rec.trades.slice() };
  trimTrades(copy.trades, total, max);
  return copy;
}

/**
 * Lo mismo para el estado de la cuenta, que lleva el día en curso: primero las velas de los trades
 * más viejos y después las ejecuciones viejas de acciones sin posición abierta (solo marcan el gráfico).
 */
export function fitState(state: TrainingState, max = MAX_DOC): TrainingState {
  let total = jsonBytes(state);
  const a = state.active;
  if (total <= max || !a) return state;
  const active: ActiveSession = { ...a, trades: a.trades.slice(), fills: a.fills.slice(), history: (a.history ?? []).slice() };
  total = trimTrades(active.trades, total, max);
  // Las órdenes ya terminadas solo se muestran en la actividad del día: se descartan las más viejas.
  while (active.history.length && total > max) total -= jsonBytes(active.history.shift()) + 1;
  const open = new Set(a.positions.map((p) => p.sym));
  for (let i = 0; i < active.fills.length && total > max; ) {
    if (open.has(active.fills[i].sym)) {
      i++;
      continue;
    }
    total -= jsonBytes(active.fills[i]) + 1;
    active.fills.splice(i, 1);
  }
  return { ...state, active };
}

export class LocalTrainingStore implements TrainingStore {
  readonly kind = 'navegador' as const;
  onFallback?: () => void;

  /** `prefix` separa la cuenta de este navegador del respaldo local de la cuenta de Claude. */
  constructor(private readonly prefix = 'pulso:training') {}

  private get keyState() {
    return this.prefix;
  }

  private get keySessions() {
    return `${this.prefix}-sessions`;
  }

  async load() {
    try {
      const state = JSON.parse(localStorage.getItem(this.keyState) ?? 'null') as TrainingState | null;
      const sessions = JSON.parse(localStorage.getItem(this.keySessions) ?? '[]') as SessionRecord[];
      return { state, sessions: Array.isArray(sessions) ? sessions : [] };
    } catch {
      return { state: null, sessions: [] };
    }
  }

  async saveState(state: TrainingState) {
    try {
      localStorage.setItem(this.keyState, JSON.stringify(state));
    } catch {
      // Sin almacenamiento disponible: la práctica sigue, pero no se recuerda al recargar.
    }
  }

  async saveSession(rec: SessionRecord) {
    try {
      const list = (JSON.parse(localStorage.getItem(this.keySessions) ?? '[]') as SessionRecord[]).filter((s) => s.id !== rec.id);
      list.unshift(fitSession(rec, 120_000));
      let json = JSON.stringify(list);
      // localStorage tiene ~5 MB: si no entra, se quitan las velas de las sesiones más viejas.
      for (let i = list.length - 1; i > 0 && json.length > 4_000_000; i--) {
        list[i] = { ...list[i], trades: list[i].trades.map(({ bars: _b, ...t }) => t) };
        json = JSON.stringify(list);
      }
      localStorage.setItem(this.keySessions, json);
    } catch {
      // Ver saveState.
    }
  }

  async clear() {
    try {
      localStorage.removeItem(this.keyState);
      localStorage.removeItem(this.keySessions);
    } catch {
      // Ver saveState.
    }
  }
}

// Subconjunto de la API `db` del artifact que se usa acá.
interface DbSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface DbDoc {
  get(): Promise<DbSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): DbCollection;
}
interface DbCollection {
  doc(id?: string): DbDoc;
  orderBy(field: string, dir?: 'asc' | 'desc'): { limit(n: number): { get(): Promise<{ docs: DbSnap[] }> } };
}
interface Db {
  doc(path: string): DbDoc;
}

/**
 * La cuenta de práctica en la base del artifact, en el espacio privado de cada persona. Si la base
 * rechaza una escritura (por ejemplo, alguien que abrió el link con permiso solo de lectura), esa
 * escritura y las siguientes van al navegador; al cargar gana el estado más nuevo de los dos.
 */
export class DbTrainingStore implements TrainingStore {
  onFallback?: () => void;
  private readonly stateDoc: DbDoc;
  private readonly sessions: DbCollection;
  private readonly local = new LocalTrainingStore('pulso:training-respaldo');
  private failed = false;
  private writing: Promise<void> = Promise.resolve();
  /** Estado que espera su turno para guardarse (si llegan varios seguidos, se guarda el último). */
  private slot: { state: TrainingState | null; started: boolean } | null = null;
  private sessionWrites: Promise<void> = Promise.resolve();

  constructor(db: Db, uid: string) {
    this.stateDoc = db.doc(`data/users/${uid}/training`);
    this.sessions = this.stateDoc.collection('sessions');
  }

  get kind(): 'cuenta' | 'navegador' {
    return this.failed ? 'navegador' : 'cuenta';
  }

  async load() {
    const [snap, list, local] = await Promise.all([this.stateDoc.get(), this.sessions.orderBy('endedAt', 'desc').limit(500).get(), this.local.load()]);
    // Lo que devuelve la base está congelado: se clona para poder modificarlo.
    const saved = snap.exists ? (structuredClone(snap.data()) as unknown as TrainingState) : null;
    const state = local.state && (!saved || local.state.updatedAt > saved.updatedAt) ? local.state : saved;
    const sessions = list.docs.filter((d) => d.exists).map((d) => structuredClone(d.data()) as unknown as SessionRecord);
    const ids = new Set(sessions.map((x) => x.id));
    return { state, sessions: [...sessions, ...local.sessions.filter((x) => !ids.has(x.id))] };
  }

  /** Una escritura por vez: si llegan varias seguidas, se guarda solo la última. */
  saveState(state: TrainingState): Promise<void> {
    if (this.failed) return this.local.saveState(state);
    if (this.slot && !this.slot.started) {
      this.slot.state = state;
      return this.writing;
    }
    const slot = { state: state as TrainingState | null, started: false };
    this.slot = slot;
    this.writing = this.writing.then(async () => {
      slot.started = true;
      const next = slot.state;
      if (!next) return;
      const body = JSON.parse(JSON.stringify(fitState(next))) as Record<string, unknown>;
      if (!(await this.write(() => this.stateDoc.set(body)))) await this.local.saveState(next);
    });
    return this.writing;
  }

  saveSession(rec: SessionRecord): Promise<void> {
    this.sessionWrites = this.sessionWrites.then(async () => {
      const body = JSON.parse(JSON.stringify(fitSession(rec))) as Record<string, unknown>;
      if (this.failed || !(await this.write(() => this.sessions.doc(rec.id).set(body)))) await this.local.saveSession(rec);
    });
    return this.sessionWrites;
  }

  /** Borra todo. Va en la misma cola que los guardados: el estado nuevo se escribe después del borrado. */
  clear(): Promise<void> {
    const run = async () => {
      await this.local.clear();
      try {
        const list = await this.sessions.orderBy('endedAt', 'desc').limit(1000).get();
        for (const d of list.docs) await this.sessions.doc(d.id).delete();
        await this.stateDoc.delete();
      } catch (e) {
        console.warn('No se pudo borrar el historial de la cuenta de Claude', e);
      }
    };
    // Lo que estaba por guardarse es la cuenta que se borra: el próximo guardado va después del borrado.
    if (this.slot && !this.slot.started) this.slot.state = null;
    this.slot = null;
    this.writing = this.writing.then(run);
    this.sessionWrites = this.sessionWrites.then(() => this.writing);
    return this.writing;
  }

  /** Reintenta una vez si la base está momentáneamente ocupada; si igual falla, se pasa al navegador. */
  private async write(fn: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try {
        await fn();
        return true;
      } catch (e) {
        const code = (e as { code?: string } | null)?.code;
        if (attempt === 0 && (code === 'unavailable' || code === 'resource_exhausted')) {
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
          continue;
        }
        console.warn('No se pudo guardar en la cuenta de Claude', e);
        break;
      }
    }
    if (!this.failed) {
      this.failed = true;
      this.onFallback?.();
    }
    return false;
  }
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

/** Elige el almacenamiento: la base del artifact si está disponible, si no el navegador. */
export async function createTrainingStore(): Promise<TrainingStore> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (claude?.use) {
    try {
      const [db, user] = (await Promise.all([claude.use('db'), claude.use('user')])) as [Db | null, { id(): Promise<string | null> } | null];
      const uid = db && user ? await user.id() : null;
      if (db && uid) return new DbTrainingStore(db, uid);
    } catch {
      // Sin base disponible para este visitante: se usa el navegador.
    }
  }
  return new LocalTrainingStore();
}
