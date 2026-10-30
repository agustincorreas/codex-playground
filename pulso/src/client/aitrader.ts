// El IA Trader: mira los escáneres como un trader de momentum, elige "la obvia", la sigue de cerca
// (velas, VWAP, EMA 9, cinta), entra con stop y objetivo 2:1, maneja la posición y sale. En modo
// "sugerencias" te propone cada paso y vos decidís; en "automático" opera solo la cuenta de práctica.
// Maneja hasta `maxPositions` posiciones a la vez (según el perfil): mientras administra una, sigue
// recorriendo las candidatas. Claude, si está disponible, opina antes de cada entrada, elige entre las
// candidatas cuando no hay una obvia y resume el día al terminar.
import { DEFAULT_SETTINGS, type Settings, type SymbolDetail, type ViewModel } from '../engine/types';
import { REG_OPEN, etParts, formatEtTime } from '../engine/time';
import { fmtMoney } from './lib/format';
import { ADVISOR_SYSTEM, dayPrompt, entryPrompt, exitPrompt, instructionPrompt, parseDecision, parseInstructionRule, parseSummary, pickPrompt, type AccountBrief, type BookBrief } from '../trading/advisor';
import { roundPx } from '../trading/depth';
import { applyInstructions, avoidedSyms, instructionLabel, instructionsToPrompt, levelFor, parseInstruction, setupFilter, watchedSyms, type Instruction } from '../trading/instructions';
import { DEFAULT_RULES, entryLabel, findAdd, findEntry, findLevelEntry, inEntryWindow, manage, newMemory, notionalCap, PROFILE_LABEL, PROFILES, profileOf, rankCandidates, sizeFor, type AiProfile, type Candidate, type EntryKind, type EntryPlan, type ExitAdvice, type PlaybookRules, type PositionMemory } from '../trading/playbook';
import { JOURNAL_LOG_MAX, newJournal, type AiClaudeNote, type AiJournal, type AiTradeContext } from './aijournal';
import { aiAvailable, type Asker } from './lib/ai';
import { load, save } from './lib/storage';
import type { DataSource } from './source/types';
import type { TrainingController } from './training';
import type { Order, Position, Trade } from '../trading/types';
import { useEffect, useState } from 'react';

export type AiMode = 'off' | 'suggest' | 'auto';

export interface AiSettings {
  mode: AiMode;
  /** Consultar a Claude antes de cada entrada (y para elegir entre las candidatas). */
  consult: boolean;
  /** Mostrar en el gráfico la acción que mira la IA. */
  follow: boolean;
  rules: PlaybookRules;
  /** Perfil del automático: fija las reglas de una vez; "personalizado" cuando se tocaron a mano. */
  profile: AiProfile;
  /** Tope de consultas a Claude por día (0 = sin tope). Al llegar, el IA Trader sigue solo con las reglas. */
  maxCalls: number;
}

export interface AiLogEntry {
  id: number;
  ts: number;
  text: string;
  tone: 'info' | 'ok' | 'error' | 'ai';
}

export interface Suggestion {
  id: number;
  ts: number;
  kind: 'pick' | 'entry' | 'exit';
  sym: string;
  title: string;
  text: string;
  plan?: EntryPlan;
  shares?: number;
  exit?: ExitAdvice;
  /** La entrada agrega a una posición ganadora (no abre una nueva). */
  add?: boolean;
}

export type AiPhase = 'off' | 'scanning' | 'watching' | 'entering' | 'inPosition' | 'paused';

export interface AiAdvice {
  ts: number;
  sym: string;
  decision: string;
  text: string;
}

/** Una posición que maneja la IA, con su R en vivo (para el panel). */
export interface AiPosition {
  sym: string;
  shares: number;
  avgCost: number;
  /** El stop vigente (el más alto entre el de la orden, el del plan y el dinámico de la IA). */
  stop: number | null;
  target: number | null;
  r: number;
  halfTaken: boolean;
  kind: string;
  secondChance: boolean;
  added: boolean;
}

/** Lo que la IA recuerda de una acción hoy. */
export interface SymDay {
  /** Cuántas veces la frenó algo (halt, spread > 2 %, dilución, "skip" de Claude). */
  brakes: number;
  /** El freno vigente (para contar cada episodio una sola vez). */
  lastBrake: string;
  trades: number;
  wins: number;
  losers: number;
  netR: number;
  /** Reentradas hechas hoy después de un stop (máximo 2). */
  reentries: number;
  /** Cuándo perdió por última vez (0 si no hay una segunda chance pendiente). */
  lastLossAt: number;
}

export interface SetupDay {
  trades: number;
  wins: number;
  losers: number;
  netR: number;
}

/** Memoria del día: por acción y por tipo de setup. Se reinicia con `reset()`. */
export interface DayMemory {
  syms: Record<string, SymDay>;
  setups: Partial<Record<EntryKind, SetupDay>>;
  trades: number;
  wins: number;
  netR: number;
}

export function newDayMemory(): DayMemory {
  return { syms: {}, setups: {}, trades: 0, wins: 0, netR: 0 };
}

export function symDay(day: DayMemory, sym: string): SymDay {
  return (day.syms[sym] ??= { brakes: 0, lastBrake: '', trades: 0, wins: 0, losers: 0, netR: 0, reentries: 0, lastLossAt: 0 });
}

/** ¿La memoria del día baja a esta acción en el ranking? (2 frenos o 2 perdedores hoy). */
export function penalized(day: DayMemory, sym: string): boolean {
  const d = day.syms[sym];
  return !!d && (d.brakes >= 2 || d.losers >= 2);
}

/** Tipos de setup que hoy ya perdieron dos veces sin ganar ninguna. */
export function avoidedSetups(day: DayMemory): Set<EntryKind> {
  const out = new Set<EntryKind>();
  for (const [k, v] of Object.entries(day.setups) as Array<[EntryKind, SetupDay]>) if (v.losers >= 2 && v.wins === 0) out.add(k);
  return out;
}

export interface AiState {
  phase: AiPhase;
  /** La acción que mira para entrar (las posiciones abiertas van en `positions`). */
  focus: string | null;
  since: number;
  candidates: Candidate[];
  suggestion: Suggestion | null;
  advice: AiAdvice | null;
  log: AiLogEntry[];
  /** Consultas a Claude hechas hoy. */
  calls: number;
  pausedReason: string;
  /** Por qué no está entrando ahora (mientras recorre o mira de cerca): se muestra en el panel. */
  waiting: string;
  /** Qué IA hay: la de Claude (artifact), la del servidor (clave de Anthropic), ninguna o todavía no se sabe. */
  ai: 'claude' | 'servidor' | 'no' | '?';
  thinking: boolean;
  /** Qué se le está preguntando a Claude ahora (una entrada bloquea otra entrada; elegir candidata o leer una indicación, no). */
  asking?: 'pick' | 'entry' | 'exit' | 'now' | 'summary' | 'instruction';
  /** La entrada que está esperando o a punto de mandar (para mostrarla en el panel y en el gráfico). */
  plan: { sym: string; kind: string; entry: number; stop: number; target: number; shares: number; note: string } | null;
  /** Las posiciones que maneja, con su R en vivo. */
  positions: AiPosition[];
  /** Resumen corto del día para el panel: trades, R neto y qué evita. */
  day: { trades: number; wins: number; netR: number; avoid: string[] };
  /** El resumen del día que escribió Claude (al terminar el día), o null. */
  daySummary: string | null;
}

const DEFAULT_AI: AiSettings = { mode: 'off', consult: true, follow: true, rules: DEFAULT_RULES, profile: 'equilibrado', maxCalls: 120 };
const px = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const ASK_TIMEOUT = 25_000;
/** Una compra que no se ejecutó en este tiempo se cancela (si se ejecutó en parte, se cancela el resto). */
const PENDING_TIMEOUT = 25_000;
/** Claude elige entre las candidatas como mucho cada 2 min (y solo si cambiaron o no hay foco). */
const PICK_EVERY = 120_000;
/** Con una candidata de 80 o más no hace falta preguntarle a Claude cuál mirar: es la obvia. */
const OBVIOUS_SCORE = 80;
/** El mismo plan en la misma acción se vuelve a considerar a los 3 min (también si Claude dijo "esperar"). */
const PLAN_RETRY = 180_000;
/** Después de salir de un trade no se busca otro por 20 s; sin segunda chance, no se vuelve a esa acción por 5 min. */
const COOLDOWN = 20_000;
const LOSER_SKIP = 5 * 60_000;
/** Una segunda chance recién se mira 90 s después del stop (y con dos velas cerradas sobre VWAP). */
const REENTRY_WAIT = 90_000;
const MAX_REENTRIES = 2;
/** Una ficha guardada vale hasta 30 s (la fuente solo manda la ficha completa de una acción por vez). */
const DETAIL_MAX_AGE = 30_000;
/** Con el servidor en vivo, el foco de la fuente rota cada 4 s (cada cambio pide una ficha completa); en el simulador, cada segundo. */
const REMOTE_ROTATE_EVERY = 4;
/** Hora de cierre (16:00 NY): a partir de ahí no se abren más trades y se pide el resumen del día. */
const MARKET_CLOSE = 16 * 60;
/** Un nivel del trader se mira de cerca (la fuente manda su ficha) desde 2 % por debajo. */
const LEVEL_NEAR = 0.98;
/** Las indicaciones se guardan en el navegador con el día del mercado al que pertenecen. */
interface SavedInstructions {
  day: string;
  list: Instruction[];
}
// El objetivo mínimo en R, el puntaje mínimo y el multiplicador del riesgo salen del perfil (settings.rules).
const LIVE: ReadonlySet<Order['status']> = new Set(['sent', 'open', 'partial']);

/** Una compra mandada por la IA que todavía está en el mercado. */
interface Pending {
  orderId: string;
  since: number;
  /** Agrega a una posición ganadora. */
  add: boolean;
}

export class AiTrader {
  settings: AiSettings;
  state: AiState = { phase: 'off', focus: null, since: 0, candidates: [], suggestion: null, advice: null, log: [], calls: 0, pausedReason: '', waiting: '', ai: '?', thinking: false, plan: null, positions: [], day: { trades: 0, wins: 0, netR: 0, avoid: [] }, daySummary: null };
  private listeners = new Set<() => void>();
  private source: DataSource | null = null;
  private view: ViewModel | null = null;
  private scanSettings: Settings = DEFAULT_SETTINGS;
  private asker: Asker | null = null;
  private seq = 0;
  private lastRank = 0;
  private lastPick = 0;
  /** Las 4 mejores candidatas de la última consulta a Claude (ordenadas): se vuelve a preguntar si cambian. */
  private lastPickKey = '';
  private lastTop = '';
  /** Lo que recuerda de cada posición que maneja (por acción). */
  private mem = new Map<string, PositionMemory>();
  private skip = new Map<string, number>();
  private lastPlanKey = '';
  private lastPlanAt = 0;
  /** Compras en curso, por acción. */
  private pending = new Map<string, Pending>();
  private cooldownUntil = 0;
  private lastExit = new Map<string, { action: string; at: number }>();
  private lastSuggestKey = '';
  private sessionId = '';
  /** Día (del reloj real) al que corresponden las consultas contadas. */
  private callsDay = '';
  private budgetWarned = false;
  private now = 0;
  /** Memoria del día (frenos y resultados por acción y por setup). */
  day = newDayMemory();
  /** Fichas recibidas (la fuente manda la completa de una sola acción por vez: las demás se guardan unos segundos). */
  private details = new Map<string, { d: SymbolDetail; at: number }>();
  private focusedDetail: SymbolDetail | null | undefined;
  /** La acción cuya ficha pide a la fuente ahora (rota entre las posiciones y la candidata). */
  private srcFocused: string | null = null;
  private rot = 0;
  private steps = 0;
  /** Acciones cuyo riesgo de dilución ya se contó como freno hoy (se cuenta una sola vez). */
  private dilutionCounted = new Set<string>();
  /** Día ya resumido por Claude (una sola vez por día). */
  private summarizedDay = '';
  /** Las indicaciones del trader (las del día y las permanentes). */
  instructions: Instruction[] = [];
  /** Día del mercado al que pertenecen las indicaciones guardadas. */
  private instrDay = '';
  /** Si se guardan en el navegador (el backtest usa un IA Trader aparte que no debe tocar las tuyas). */
  private readonly persistInstr: boolean;
  /** El informe del día: todo lo que hizo y por qué (se exporta desde el panel). */
  journal: AiJournal = newJournal('', '', 'equilibrado', DEFAULT_RULES, 'off', 0, this.day);
  /** El informe del día anterior (por si el día cambió antes de exportarlo). */
  prevJournal: AiJournal | null = null;
  private journalDirty = false;
  private journalSavedAt = 0;
  /** La última opinión de Claude sobre una entrada, por acción (se pega al trade si se compra). */
  private claudeNotes = new Map<string, AiClaudeNote>();
  /** Entradas dejadas pasar ya anotadas (una por acción, setup y motivo cada 3 min). */
  private missedKeys = new Map<string, number>();

  constructor(
    private readonly c: TrainingController,
    private readonly onSelect: (sym: string) => void,
    opts: { instructions?: boolean } = {},
  ) {
    const saved = load<Partial<AiSettings>>('ai-settings', {});
    this.settings = { ...DEFAULT_AI, ...saved, rules: { ...DEFAULT_RULES, ...(saved.rules ?? {}) } };
    this.settings.profile = profileOf(this.settings.rules);
    this.state.phase = this.settings.mode === 'off' ? 'off' : 'scanning';
    this.persistInstr = opts.instructions !== false;
    if (this.persistInstr) {
      const sj = load<AiJournal | null>('ai-journal', null);
      if (sj && typeof sj.sessionId === 'string' && Array.isArray(sj.trades) && Array.isArray(sj.log)) this.journal = { ...newJournal(sj.sessionId, sj.day, sj.profile, sj.rules ?? DEFAULT_RULES, sj.mode, sj.startedAt, sj.memory ?? newDayMemory()), ...sj };
      const pj = load<AiJournal | null>('ai-journal-prev', null);
      if (pj && typeof pj.sessionId === 'string' && Array.isArray(pj.trades)) this.prevJournal = pj;
    }
    if (this.persistInstr) {
      const si = load<SavedInstructions>('ai-instructions', { day: '', list: [] });
      this.instrDay = typeof si.day === 'string' ? si.day : '';
      this.instructions = Array.isArray(si.list) ? si.list.filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string' && i.rule && typeof i.rule.kind === 'string') : [];
      this.rollInstructions();
      this.syncInstrTracked();
    }
    void aiAvailable().then((ai) => {
      this.asker = ai?.ask ?? null;
      this.state.ai = ai ? ai.via : 'no';
      this.emit();
    });
    // Otro día, otra cuenta (recargada o importada): lo que la IA recordaba ya no vale. Antes de
    // olvidarlo, Claude resume el día que terminó (si hubo trades).
    c.onDayChange(() => {
      const rec = c.lastEnded;
      if (rec && rec.trades.length) void this.summarizeDay(rec.id, rec.trades);
      this.reset();
    });
  }

  /** Vuelve al principio: sin foco, sin memoria de posiciones, planes ni del día (al cambiar de día o de cuenta). */
  reset(): void {
    this.mem.clear();
    this.skip.clear();
    this.pending.clear();
    this.day = newDayMemory();
    this.cooldownUntil = 0;
    this.lastPlanKey = '';
    this.lastPlanAt = 0;
    this.lastPickKey = '';
    this.lastPick = 0;
    this.lastRank = 0;
    this.lastTop = '';
    this.lastExit.clear();
    this.lastSuggestKey = '';
    this.sessionId = '';
    this.details.clear();
    this.dilutionCounted.clear();
    this.claudeNotes.clear();
    this.missedKeys.clear();
    this.focusedDetail = undefined;
    this.state.candidates = [];
    this.state.suggestion = null;
    this.state.advice = null;
    this.state.plan = null;
    this.state.positions = [];
    this.state.day = { trades: 0, wins: 0, netR: 0, avoid: [] };
    this.state.daySummary = null;
    this.rollInstructions();
    this.focusOn(null);
    this.srcFocus(null);
    if (this.state.phase !== 'off') this.setPhase('scanning');
    this.emit();
  }

  // ------------------------------------------------------------------ indicaciones del trader

  /**
   * Agrega una indicación escrita en castellano. Se interpreta enseguida con las reglas simples y, si hay
   * IA, se le pide a Claude que la convierta en una regla (una consulta, cuenta en el presupuesto): si
   * la entiende, reemplaza la lectura de las reglas; si no, queda la de las reglas.
   */
  async addInstruction(text: string, permanent = false): Promise<Instruction | null> {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const ins: Instruction = { id: `${Date.now().toString(36)}-${++this.seq}`, text: clean, createdAt: Date.now(), permanent, rule: parseInstruction(clean), by: 'reglas' };
    this.instructions = [...this.instructions, ins];
    this.saveInstructions();
    this.syncInstrTracked();
    if (!this.journal.instructions.includes(clean)) this.journal.instructions.push(clean);
    this.log(`Indicación: ${instructionLabel(ins.rule)}.`, 'info');
    if (this.canAsk()) {
      try {
        const rule = parseInstructionRule(await this.askRaw(instructionPrompt(clean), 'instruction'));
        if (rule) {
          this.instructions = this.instructions.map((i) => (i.id === ins.id ? { ...i, rule, by: 'claude' } : i));
          this.saveInstructions();
          this.syncInstrTracked();
          this.log(`Claude entendió "${clean}" como: ${instructionLabel(rule)}.`, 'ai');
        } else this.log(`Claude no entendió la indicación: queda como la leyeron las reglas (${instructionLabel(ins.rule)}).`, 'info');
      } catch (e) {
        this.log(`Claude no leyó la indicación (${(e as Error).message}): queda como la leyeron las reglas.`, 'error');
      }
    }
    this.emit();
    return this.instructions.find((i) => i.id === ins.id) ?? ins;
  }

  removeInstruction(id: string): void {
    this.instructions = this.instructions.filter((i) => i.id !== id);
    this.saveInstructions();
    this.syncInstrTracked();
    this.emit();
  }

  setInstructionPermanent(id: string, permanent: boolean): void {
    this.instructions = this.instructions.map((i) => (i.id === id ? { ...i, permanent } : i));
    this.saveInstructions();
    this.emit();
  }

  private saveInstructions(): void {
    if (!this.persistInstr) return;
    const saved: SavedInstructions = { day: this.instrDay, list: this.instructions };
    save('ai-instructions', saved);
  }

  /** Otro día del mercado: se borran las indicaciones de ayer, salvo las permanentes (que vuelven a estar pendientes). */
  private rollInstructions(): void {
    const day = this.c.active?.dayKey ?? '';
    if (!day || day === this.instrDay) return;
    const first = !this.instrDay;
    this.instrDay = day;
    const before = this.instructions.length;
    this.instructions = this.instructions.filter((i) => i.permanent).map((i) => (i.done ? { ...i, done: false } : i));
    if (!first && before !== this.instructions.length) this.log(`Otro día: se borran las indicaciones de ayer${this.instructions.length ? ` (quedan ${this.instructions.length} permanente${this.instructions.length === 1 ? '' : 's'})` : ''}.`, 'info');
    this.saveInstructions();
    this.syncInstrTracked();
  }

  /** Las acciones de "mirá" y de niveles se siguen en la fuente aunque no estén en ningún escáner. */
  private syncInstrTracked(): void {
    this.c.setAiTracked([...watchedSyms(this.instructions)]);
    this.lastRank = 0;
  }

  /** Las reglas del perfil acotadas por las indicaciones (horario y tope de trades). */
  private rules(): PlaybookRules {
    return applyInstructions(this.settings.rules, this.instructions);
  }

  private avoided(sym: string): boolean {
    return avoidedSyms(this.instructions).has(sym);
  }

  /** El bloque "Indicaciones del trader" para los prompts ('' si no hay). */
  private instrBlock(): string {
    return instructionsToPrompt(this.instructions);
  }

  /** Un nivel del trader que se está cruzando ahora (con la ficha a mano y el setup limpio), o null. */
  private levelReady(taken: ReadonlySet<string>, r: PlaybookRules): string | null {
    if (setupFilter(this.instructions).has('level')) return null;
    for (const i of this.instructions) {
      if (i.rule.kind !== 'level' || i.done) continue;
      const sym = i.rule.sym;
      if (taken.has(sym) || this.avoided(sym)) continue;
      const detail = this.detailOf(sym);
      if (detail && findLevelEntry(detail, this.source?.quote(sym) ?? null, i.rule.price, r)) return sym;
    }
    return null;
  }

  /** Niveles del trader a menos de 2 % (la fuente tiene que mandar su ficha para ver el cruce). */
  private nearLevels(): string[] {
    const out: string[] = [];
    for (const i of this.instructions) {
      if (i.rule.kind !== 'level' || i.done || this.avoided(i.rule.sym)) continue;
      const price = this.source?.quote(i.rule.sym)?.last || this.source?.row(i.rule.sym)?.price || 0;
      if (price >= i.rule.price * LEVEL_NEAR && !out.includes(i.rule.sym)) out.push(i.rule.sym);
    }
    return out;
  }

  /** Un plan de entrada: primero un nivel del trader (si lo hay y se está cruzando), después los setups del libro. */
  private findPlan(detail: SymbolDetail, quote: ReturnType<DataSource['quote']>, r: PlaybookRules, skip: ReadonlySet<EntryKind>): EntryPlan | null {
    const lvl = skip.has('level') ? undefined : levelFor(this.instructions, detail.sym);
    const byLevel = lvl ? findLevelEntry(detail, quote, lvl.rule.price, r) : null;
    return byLevel ?? findEntry(detail, quote, this.now, r, skip);
  }

  /** Un nivel disparó su entrada: la indicación queda cumplida (tachada) y no vuelve a disparar. */
  private fulfilLevel(sym: string): void {
    const lvl = levelFor(this.instructions, sym);
    if (!lvl) return;
    this.instructions = this.instructions.map((i) => (i.id === lvl.id ? { ...i, done: true } : i));
    this.saveInstructions();
    this.syncInstrTracked();
    this.log(`Indicación cumplida: ${instructionLabel(lvl.rule)}.`, 'info');
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  attach(source: DataSource): void {
    this.source = source;
    this.focusedDetail = undefined;
    if (this.srcFocused) source.focus?.(this.srcFocused);
  }

  detach(): void {
    this.source = null;
  }

  setView(view: ViewModel, settings: Settings): void {
    this.view = view;
    this.scanSettings = settings;
  }

  update(patch: Partial<AiSettings>): void {
    // Elegir un perfil carga sus reglas; tocar una regla a mano deja el perfil en "personalizado".
    if (patch.profile && patch.profile !== 'personalizado') patch = { ...patch, rules: { ...PROFILES[patch.profile] } };
    this.settings = { ...this.settings, ...patch, rules: { ...this.settings.rules, ...(patch.rules ?? {}) } };
    this.settings.profile = profileOf(this.settings.rules);
    save('ai-settings', this.settings);
    if (patch.profile && patch.profile !== 'personalizado') this.log(`Perfil ${PROFILE_LABEL[patch.profile].toLowerCase()}: ${this.profileSummary()}`, 'info');
    if (patch.mode !== undefined) {
      if (patch.mode === 'off') {
        this.setPhase('off');
        this.focusOn(null);
        this.state.suggestion = null;
        this.state.plan = null;
      } else if (this.state.phase === 'off') this.setPhase('scanning');
      this.log(patch.mode === 'off' ? 'IA Trader apagado.' : patch.mode === 'auto' ? 'Modo automático: opera solo la cuenta de práctica.' : 'Modo sugerencias: propone y vos decidís.', 'info');
    }
    this.emit();
  }

  private profileSummary(): string {
    const r = this.settings.rules;
    const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    return `entradas de ${hhmm(r.entryFrom)} a ${hhmm(r.entryTo)}, hasta ${r.maxTrades} trades, ${r.maxLosers} perdedores o ${r.maxLossR}R, riesgo ×${r.riskMult}, candidatas de ${r.minScore}+, objetivo ${r.targetR}:1${r.firstTakeR < r.targetR ? ` (la mitad a ${r.firstTakeR}R)` : ''}${r.bailSec > 0 ? `, afuera si no arranca en ${r.bailSec} s` : ''}${r.askBeforeEntry ? '' : ', sin consultar a Claude antes de entrar'}, ${r.maxPositions} posici${r.maxPositions === 1 ? 'ón' : 'ones'} a la vez (${r.maxOpenRiskR}R abiertos).`;
  }

  /** Riesgo por trade de este perfil: el de la cuenta por el multiplicador del perfil. */
  private risk(): number {
    return this.c.riskAmount() * this.settings.rules.riskMult;
  }

  private log(text: string, tone: AiLogEntry['tone'] = 'info'): void {
    const entry: AiLogEntry = { id: ++this.seq, ts: this.now || Date.now(), text, tone };
    this.state.log = [...this.state.log.slice(-79), entry];
    if (this.journal.log.length < JOURNAL_LOG_MAX) this.journal.log.push(entry);
    this.journalDirty = true;
    this.emit();
  }

  // ------------------------------------------------------------------ informe del día

  /** Otra sesión de práctica (otro día): el informe que había pasa a "anterior" y empieza uno nuevo. */
  private startJournal(sessionId: string, day: string): void {
    if (this.journal.sessionId === sessionId) {
      this.day = this.journal.memory;
      return;
    }
    if (this.journal.sessionId && (this.journal.trades.length || this.journal.log.length)) {
      this.prevJournal = this.journal;
      if (this.persistInstr) save('ai-journal-prev', this.prevJournal);
    }
    this.journal = newJournal(sessionId, day, PROFILE_LABEL[this.settings.profile].toLowerCase(), { ...this.settings.rules }, this.settings.mode, this.now || Date.now(), this.day);
    this.journal.instructions = this.instructions.map((i) => i.text);
    this.saveJournal();
  }

  private saveJournal(): void {
    this.journalDirty = false;
    this.journalSavedAt = this.now;
    this.journal.memory = this.day;
    this.journal.profile = PROFILE_LABEL[this.settings.profile].toLowerCase();
    this.journal.mode = this.settings.mode;
    if (this.persistInstr) save('ai-journal', this.journal);
  }

  /** Los trades de la cuenta de esa sesión (la activa o una terminada), para el informe. */
  tradesOf(sessionId: string): Trade[] {
    const a = this.c.active;
    if (a && a.id === sessionId) return a.trades;
    const rec = this.c.lastEnded;
    if (rec && rec.id === sessionId) return rec.trades;
    return [];
  }

  /** El informe para exportar: el de hoy si tiene algo; si no, el del día anterior. */
  reportJournal(): AiJournal {
    return this.journal.trades.length || this.journal.log.length || !this.prevJournal ? this.journal : this.prevJournal;
  }

  /** Anota una opinión de Claude en el informe (y, si es sobre una entrada, la guarda para pegarla al trade). */
  private note(n: AiClaudeNote): void {
    this.journal.claude.push(n);
    if (n.kind === 'entry') this.claudeNotes.set(n.sym, n);
    this.journalDirty = true;
  }

  /** Anota una entrada que se dejó pasar (una vez cada 3 min por acción, setup y motivo). */
  private missed(sym: string, plan: EntryPlan, why: string): void {
    const key = `${sym}:${plan.kind}:${why.slice(0, 40)}`;
    const last = this.missedKeys.get(key) ?? 0;
    if (this.now - last < 180_000) return;
    this.missedKeys.set(key, this.now);
    this.journal.missed.push({ at: this.now, sym, kind: entryLabel(plan.kind), entry: plan.entry, stop: plan.stop, why });
    this.journalDirty = true;
  }

  /** El contexto de una entrada para el informe (puntaje, volumen, float, spread, vela, tamaño sobre el capital). */
  private contextOf(sym: string, entry: number, shares: number): AiTradeContext {
    const cand = this.state.candidates.find((c) => c.sym === sym);
    const row = this.detailOf(sym)?.row ?? cand?.row ?? this.source?.row(sym) ?? null;
    const bars = this.detailOf(sym)?.bars ?? [];
    const last = bars[bars.length - 1];
    const q = this.source?.quote(sym);
    const ask = q?.ask || row?.ask || entry;
    const bid = q?.bid || row?.bid || entry;
    const equity = this.c.summary().equity;
    return {
      score: cand?.score ?? 0,
      reasons: cand?.reasons ?? [],
      warnings: cand?.warnings ?? [],
      rvol: row?.rvol ?? 0,
      rvol5m: row?.rvol5m ?? 0,
      float: row?.float,
      changePct: row?.changePct ?? 0,
      pctFromHod: row?.pctFromHod ?? 0,
      spreadPct: ask > 0 && bid > 0 ? ((ask - bid) / ask) * 100 : 0,
      candlePct: last && last.o > 0 ? (entry / last.o - 1) * 100 : 0,
      preMarket: this.preMarket(),
      equityPct: equity > 0 ? ((entry * shares) / equity) * 100 : 0,
    };
  }

  private preMarket(): boolean {
    return etParts(this.now).minutes < REG_OPEN;
  }

  /** Tamaño por riesgo, acotado por el poder de compra, el tope de valor del perfil (la mitad en pre-market) y la liquidez. */
  private size(entry: number, stop: number, detail: SymbolDetail): number {
    const cap = this.c.summary().equity * notionalCap(this.settings.profile, this.preMarket());
    return sizeFor(this.risk(), entry, stop, this.c.summary().buyingPower, this.liquidity(detail), cap);
  }

  private setPhase(phase: AiPhase, reason = ''): void {
    if (this.state.phase !== phase || this.state.pausedReason !== reason) {
      this.state.phase = phase;
      this.state.pausedReason = reason;
      this.state.since = this.now;
      this.emit();
    }
  }

  private setPlan(plan: AiState['plan']): void {
    const a = this.state.plan;
    if (a === plan || (a && plan && a.sym === plan.sym && a.entry === plan.entry && a.stop === plan.stop && a.shares === plan.shares && a.note === plan.note)) return;
    this.state.plan = plan;
    this.emit();
  }

  /** La acción que mira para entrar (no las posiciones: esas se manejan aparte). */
  private focusOn(sym: string | null, why?: string): void {
    if (sym === this.state.focus) return;
    this.state.focus = sym;
    this.state.since = this.now;
    if (sym) {
      this.srcFocus(sym);
      const cand = this.state.candidates.find((x) => x.sym === sym);
      this.log(`Mirando ${sym}${why ? ` (${why})` : ''}${cand ? `: ${cand.reasons.join(', ')}` : ''}.`);
      if (this.settings.follow && this.settings.mode === 'auto') this.onSelect(sym);
    }
    this.emit();
  }

  /** Le pide a la fuente la ficha completa de esta acción. */
  private srcFocus(sym: string | null): void {
    if (sym === this.srcFocused) return;
    this.srcFocused = sym;
    this.focusedDetail = undefined;
    this.source?.focus?.(sym);
  }

  /** La fuente manda la ficha de una sola acción: se turna entre las posiciones, las compras en curso y la candidata. */
  private rotateFocus(held: string[]): void {
    const list = [...new Set([...held, ...this.pending.keys(), ...(this.state.focus ? [this.state.focus] : []), ...this.nearLevels()])];
    if (!list.length) return this.srcFocus(null);
    if (list.length === 1) return this.srcFocus(list[0]);
    if (this.source?.kind === 'remote' && ++this.steps % REMOTE_ROTATE_EVERY !== 0) return;
    this.srcFocus(list[++this.rot % list.length]);
  }

  private suggest(s: Omit<Suggestion, 'id' | 'ts'>): void {
    const key = `${s.kind}:${s.sym}:${s.title}`;
    if (key === this.lastSuggestKey && this.state.suggestion && this.now - this.state.suggestion.ts < 90_000) return;
    this.lastSuggestKey = key;
    this.state.suggestion = { ...s, id: ++this.seq, ts: this.now };
    this.c.notify(`IA: ${s.title}`, 'info');
    this.emit();
  }

  dismiss(): void {
    this.state.suggestion = null;
    this.emit();
  }

  /** Hacer lo que propone la sugerencia. */
  accept(): void {
    const s = this.state.suggestion;
    if (!s) return;
    this.state.suggestion = null;
    if (s.kind === 'pick') this.onSelect(s.sym);
    else if (s.kind === 'entry' && s.plan && s.shares) this.execute(s.sym, s.plan, s.shares, 'tu decisión', { add: s.add });
    else if (s.kind === 'exit' && s.exit) this.applyExit(s.sym, s.exit, 'tu decisión');
    this.emit();
  }

  private brief(): AccountBrief {
    const sum = this.c.summary();
    return { equity: sum.equity, riskPerTrade: this.risk(), dayPnl: sum.dayPnl, tradesToday: this.c.active?.trades.length ?? 0, losersInARow: this.losersInARow() };
  }

  private losersInARow(): number {
    const trades = this.c.active?.trades ?? [];
    let n = 0;
    for (let i = trades.length - 1; i >= 0 && trades[i].net < 0; i--) n++;
    return n;
  }

  /** Las consultas se cuentan por día del reloj real (el tope es un costo, no una regla del mercado). */
  private rollCalls(): void {
    const day = new Date().toDateString();
    if (day !== this.callsDay) {
      this.callsDay = day;
      this.state.calls = 0;
      this.budgetWarned = false;
    }
  }

  /** ¿Se le puede preguntar a Claude ahora? (hay IA y no se llegó al tope del día). Avisa una vez al llegar. */
  private canAsk(): boolean {
    if (!this.asker) return false;
    this.rollCalls();
    const max = this.settings.maxCalls;
    if (max > 0 && this.state.calls >= max) {
      if (!this.budgetWarned) {
        this.budgetWarned = true;
        this.log(`Se llegó al tope de ${max} consultas a Claude por hoy: hasta mañana el IA Trader sigue solo con las reglas.`, 'error');
      }
      return false;
    }
    return true;
  }

  private async askRaw(prompt: string, kind: AiState['asking'] = 'now'): Promise<string> {
    if (!this.asker) throw new Error('no hay IA');
    this.rollCalls();
    this.state.thinking = true;
    this.state.asking = kind;
    this.state.calls++;
    this.emit();
    try {
      return await Promise.race([this.asker(ADVISOR_SYSTEM, prompt), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('Claude tardó más de 25 s')), ASK_TIMEOUT))]);
    } finally {
      this.state.thinking = false;
      this.state.asking = undefined;
      this.emit();
    }
  }

  private async ask(prompt: string, kind: AiState['asking'] = 'now'): Promise<ReturnType<typeof parseDecision>> {
    if (!this.asker) return null;
    return parseDecision(await this.askRaw(prompt, kind));
  }

  /** Preguntarle a Claude ahora mismo por lo que está mirando (o por la posición abierta). */
  async askNow(): Promise<void> {
    if (!this.asker || !this.source) return;
    const now = this.now || Date.now();
    const held = this.positions();
    try {
      if (held.length) {
        const sym = held[0];
        const pos = this.c.broker!.position(sym)!;
        const detail = this.detailOf(sym);
        if (!detail) return;
        const d = await this.ask(exitPrompt(detail, this.source.quote(sym), pos, this.mem.get(sym) ?? newMemory(pos.openedAt, pos.avgCost), now, this.brief(), this.instrBlock()));
        if (d) this.state.advice = { ts: now, sym, decision: d.decision, text: d.reason };
      } else if (this.state.focus) {
        const detail = this.detailOf(this.state.focus);
        if (!detail) return;
        const plan = this.findPlan(detail, this.source.quote(detail.sym), this.rules(), setupFilter(this.instructions));
        const shares = plan ? this.size(plan.entry, plan.stop, detail) : 0;
        const d = plan && shares > 0 ? await this.ask(entryPrompt(detail, this.source.quote(detail.sym), plan, shares, now, this.brief(), this.bookOf(detail.sym), this.instrBlock())) : await this.ask(pickPrompt(this.state.candidates, now, this.brief(), this.instrBlock()));
        if (d) this.state.advice = { ts: now, sym: d.sym ?? detail.sym, decision: d.decision, text: d.reason };
      } else if (this.state.candidates.length) {
        const d = await this.ask(pickPrompt(this.state.candidates, now, this.brief(), this.instrBlock()));
        if (d) this.state.advice = { ts: now, sym: d.sym ?? '', decision: d.decision, text: d.reason };
      }
      if (this.state.advice) {
        this.note({ at: now, sym: this.state.advice.sym, kind: held.length ? 'exit' : 'pick', decision: this.state.advice.decision, reason: this.state.advice.text });
        this.log(`Claude: ${this.state.advice.text}`, 'ai');
      }
    } catch (e) {
      this.log(`Claude no respondió: ${(e as Error).message}`, 'error');
    }
    this.emit();
  }

  /** Volumen por minuto para no comprar más del 10 % de lo que opera: lo mayor entre la cotización y los últimos 5 min. */
  private liquidity(detail: SymbolDetail): number {
    return Math.max(this.source?.quote(detail.sym)?.volPerMin ?? 0, detail.row.vol5m / 5, detail.bars.slice(-3).reduce((v, b) => v + b.v, 0) / 3);
  }

  /** Los 3 mejores niveles por lado del Level 2, sumados por precio (para contárselos a Claude). */
  private bookOf(sym: string): BookBrief | null {
    const b = this.source?.book(sym);
    if (!b) return null;
    const side = (levels: typeof b.bids) => levels.slice(0, 3).map((l) => ({ price: l.price, size: l.rows.reduce((v, r) => v + r.size, 0) }));
    return { bids: side(b.bids), asks: side(b.asks) };
  }

  /**
   * La ficha de una acción: la que manda la fuente si está en foco; si no, la última guardada (vale 20 s).
   * Con varias posiciones el foco de la fuente rota, así que cada una se mira con una ficha de hace
   * pocos segundos y la cotización de ahora.
   */
  private detailOf(sym: string): SymbolDetail | null {
    if (this.focusedDetail === undefined) {
      this.focusedDetail = this.source?.focusDetail?.() ?? null;
      if (this.focusedDetail) this.details.set(this.focusedDetail.sym, { d: this.focusedDetail, at: this.now });
    }
    if (this.focusedDetail?.sym === sym) return this.focusedDetail;
    const c = this.details.get(sym);
    return c && this.now - c.at <= DETAIL_MAX_AGE ? c.d : null;
  }

  /** Posiciones que maneja la IA: solo las compradas (los cortos que abra el usuario a mano no son de ella). */
  private positions(): string[] {
    return this.c.broker?.session.positions.filter((p) => p.side !== 'short').map((p) => p.sym) ?? [];
  }

  /** La compra en curso de esta acción, si sigue viva en el mercado. */
  private pendingBuy(sym: string): Order | undefined {
    const p = this.pending.get(sym);
    const o = p ? this.c.broker?.order(p.orderId) : undefined;
    return o && LIVE.has(o.status) ? o : undefined;
  }

  /** Pasados 25 s, la compra que no se ejecutó (o lo que falta de ella) se cancela. Devuelve si se canceló. */
  private expirePending(sym: string): boolean {
    const p = this.pending.get(sym);
    const o = this.pendingBuy(sym);
    if (!p || !o || this.now - p.since <= PENDING_TIMEOUT) return false;
    this.c.cancel(o.id);
    this.log(o.filled > 0 ? `${o.sym}: se ejecutaron ${o.filled} de ${o.shares} en 25 s; se cancela el resto y se maneja lo que hay.` : `${o.sym}: la compra no se ejecutó en 25 s, se cancela.`, 'info');
    return true;
  }

  /** Un paso por segundo, con la hora del mercado. */
  step(now: number): void {
    this.now = now;
    this.focusedDetail = undefined;
    if (this.settings.mode === 'off' || !this.source || !this.source.ready) return;
    const a = this.c.active;
    if (!a) return;
    if (a.id !== this.sessionId) {
      this.reset();
      this.sessionId = a.id;
      this.startJournal(a.id, a.dayKey);
    }
    if (this.journalDirty && now - this.journalSavedAt > 5000) this.saveJournal();
    // 1. Posiciones abiertas (tuyas o de la IA): cada una se maneja.
    const held = this.positions();
    for (const sym of held) this.managePosition(sym);
    // 2. Compras en curso: con posición, lo que falta no se espera más de 25 s; sin posición, a los 25 s se
    //    cancela; y si ya no está viva y no hay posición, se ejecutó y cerró enseguida (o la canceló el bróker).
    for (const [sym, p] of [...this.pending]) {
      const live = !!this.pendingBuy(sym);
      if (held.includes(sym)) {
        if (!live || this.expirePending(sym)) this.pending.delete(sym);
        continue;
      }
      if (live) {
        // Una compra para agregar cuya posición ya cerró (el stop de la orden, por ejemplo) no tiene que ejecutarse.
        if (p.add) {
          this.c.cancel(p.orderId);
          this.pending.delete(sym);
          continue;
        }
        if (this.expirePending(sym)) {
          this.pending.delete(sym);
          this.mem.delete(sym);
        }
        continue;
      }
      this.pending.delete(sym);
      if (!p.add) this.afterTrade(sym);
    }
    // 3. Posiciones que cerraron (por el stop, el objetivo, una venta o el bróker).
    for (const sym of [...this.mem.keys()]) if (!held.includes(sym) && !this.pending.has(sym)) this.afterTrade(sym);
    this.snapshot(held);
    // 4. Buscar otra entrada (si el perfil deja tener más posiciones).
    this.scan(held);
    this.rotateFocus(held);
  }

  /** Lo que ve el panel: las posiciones con su R en vivo y el resumen del día. */
  private snapshot(held: string[]): void {
    const positions: AiPosition[] = [];
    for (const sym of held) {
      const pos = this.c.broker?.position(sym);
      if (!pos) continue;
      const mem = this.mem.get(sym);
      const last = this.source?.quote(sym)?.last || pos.avgCost;
      const risk = pos.initialStop ? pos.avgCost - pos.initialStop : pos.avgCost * 0.03;
      const stop = this.currentStop(pos, mem);
      positions.push({ sym, shares: pos.shares, avgCost: pos.avgCost, stop: stop > 0 ? stop : null, target: pos.target ?? pos.planTarget ?? null, r: risk > 0 ? (last - pos.avgCost) / risk : 0, halfTaken: !!mem?.halfTaken, kind: mem?.kind ? entryLabel(mem.kind) : (pos.setup ?? ''), secondChance: !!mem?.secondChance, added: !!mem?.addedOnce });
    }
    const avoid = [...Object.keys(this.day.syms).filter((s) => penalized(this.day, s)), ...[...avoidedSetups(this.day)].map((k) => entryLabel(k).toLowerCase())];
    const prev = this.state;
    const changed = positions.length !== prev.positions.length || positions.some((p, i) => JSON.stringify(p) !== JSON.stringify(prev.positions[i])) || avoid.join() !== prev.day.avoid.join() || this.day.trades !== prev.day.trades;
    if (!changed) return;
    this.state.positions = positions;
    this.state.day = { trades: this.day.trades, wins: this.day.wins, netR: this.day.netR, avoid };
    this.emit();
  }

  /** El stop vigente de una posición: el más alto entre el de la orden, el del plan y el dinámico de la IA. */
  private currentStop(pos: Position, mem?: PositionMemory): number {
    const base = mem?.breakeven ? pos.avgCost : (pos.stop ?? pos.planStop ?? pos.initialStop ?? 0);
    return Math.max(base, mem?.stop ?? 0);
  }

  /** Riesgo abierto total: (entrada − stop vigente) × acciones de cada posición y compra en curso (el stop en la entrada cuenta 0). */
  private openRisk(held: string[]): number {
    let sum = 0;
    for (const sym of held) {
      const pos = this.c.broker?.position(sym);
      if (!pos) continue;
      const stop = this.currentStop(pos, this.mem.get(sym)) || pos.avgCost * 0.97;
      sum += Math.max(0, pos.avgCost - stop) * pos.shares;
    }
    for (const [sym] of this.pending) {
      if (held.includes(sym)) continue;
      const o = this.pendingBuy(sym);
      const stop = o?.bracket?.stop ?? o?.plan?.stop;
      if (o && o.price && stop) sum += Math.max(0, o.price - stop) * (o.shares - o.filled);
    }
    return sum;
  }

  /** Lo que queda del riesgo abierto que permite el perfil (en US$). */
  private riskBudget(held: string[]): number {
    return this.settings.rules.maxOpenRiskR * this.risk() - this.openRisk(held);
  }

  /** Achica un tamaño para que (entrada − stop) × acciones entre en lo que queda del riesgo abierto (con otras posiciones). */
  private fitRisk(entry: number, stop: number, shares: number, held = this.positions()): number {
    if (!held.length && !this.pending.size) return shares;
    const perShare = entry - stop;
    if (!(perShare > 0)) return shares;
    return Math.min(shares, lots(Math.floor(this.riskBudget(held) / perShare)));
  }

  /** Una posición que va perdiendo más de 0,5R (mientras tanto no se abre otra), o ''. */
  private losingPosition(held: string[]): string {
    for (const sym of held) {
      const pos = this.c.broker?.position(sym);
      const last = this.source?.quote(sym)?.last;
      if (!pos || !last) continue;
      const risk = pos.initialStop ? pos.avgCost - pos.initialStop : pos.avgCost * 0.03;
      if (risk > 0 && (last - pos.avgCost) / risk < -0.5) return sym;
    }
    return '';
  }

  /** Busca otra entrada: candidatas, foco, setup, tamaño (respetando el tope de posiciones y el riesgo abierto). */
  private scan(held: string[]): void {
    const now = this.now;
    const r = this.rules();
    const inFlight = [...this.pending.keys()].filter((s) => !held.includes(s));
    const busy = held.length + inFlight.length;
    const openPhase: AiPhase | null = held.length ? 'inPosition' : inFlight.length ? 'entering' : null;
    const pause = this.limits();
    if (pause) {
      if (openPhase) {
        this.setPhase(openPhase);
        this.wait(pause);
      } else {
        this.setPhase('paused', pause);
        this.wait('');
        if (pause.startsWith('Cerró el mercado') && this.c.active?.trades.length) void this.summarizeDay(this.c.active.id, this.c.active.trades);
      }
      return this.setPlan(null);
    }
    if (busy >= r.maxPositions) {
      this.setPhase(openPhase ?? 'scanning');
      this.setPlan(null);
      return this.wait(r.maxPositions > 1 ? `Ya maneja ${busy} posiciones: el tope del perfil.` : '');
    }
    const losing = this.losingPosition(held);
    if (losing) {
      this.setPhase(openPhase ?? 'scanning');
      this.setPlan(null);
      return this.wait(`${losing} va perdiendo más de 0,5R: no se abre otra mientras tanto.`);
    }
    if (now < this.cooldownUntil) {
      this.setPhase(openPhase ?? 'scanning');
      return this.wait('Pausa de 20 s después del último trade.');
    }
    if (now - this.lastRank > 5000) {
      this.lastRank = now;
      this.rank();
    }
    const taken = new Set([...held, ...this.pending.keys()]);
    const eligible = this.state.candidates.filter((c) => !taken.has(c.sym));
    const top = eligible[0];
    // Un nivel del trader que se está cruzando manda sobre el ranking: se mira esa acción.
    const level = this.levelReady(taken, r);
    if (level) this.focusOn(level, 'nivel del trader');
    else {
      const focusStillGood = this.state.focus && !taken.has(this.state.focus) && eligible.slice(0, 4).some((x) => x.sym === this.state.focus);
      if (!focusStillGood) {
        if (top && top.score >= r.minScore) this.focusOn(top.sym, 'la mejor del escáner');
        else this.focusOn(null);
      }
    }
    // Claude elige entre las candidatas: solo en el horario de entradas, no más seguido que cada 2 min, solo si
    // cambiaron las 4 mejores o no hay ninguna en foco (cada consulta cuesta), y nunca si la mejor es obvia (80+).
    if (this.settings.mode === 'auto' && this.settings.consult && !this.state.thinking && eligible.length >= 2 && !(top && top.score >= OBVIOUS_SCORE) && inEntryWindow(now, r) && now - this.lastPick > PICK_EVERY) {
      const key = eligible
        .slice(0, 4)
        .map((x) => x.sym)
        .sort()
        .join(',');
      if ((key !== this.lastPickKey || !this.state.focus) && this.canAsk()) {
        this.lastPick = now;
        this.lastPickKey = key;
        void this.askPick(eligible);
      }
    }
    const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    if (!this.state.focus) {
      this.setPhase(openPhase ?? 'scanning');
      this.setPlan(null);
      return this.wait(top ? `La mejor candidata (${top.sym}, ${top.score}) no llega al mínimo del perfil (${r.minScore}).` : 'Sin candidatas con volumen, noticia y float chico.');
    }
    this.setPhase(openPhase ?? 'watching');
    const sym = this.state.focus;
    const detail = this.detailOf(sym);
    if (!detail) return this.wait(`Esperando los datos de ${sym}…`);
    if (!inEntryWindow(now, r)) {
      this.setPlan(null);
      const own = r.entryFrom !== this.settings.rules.entryFrom || r.entryTo !== this.settings.rules.entryTo;
      return this.wait(`Fuera del horario de entradas ${own ? 'que pediste' : 'del perfil'} (${hhmm(r.entryFrom)} a ${hhmm(r.entryTo)} NY).`);
    }
    const quote = this.source!.quote(sym);
    // Frenos (se cuentan una vez por episodio en la memoria del día): halt, spread ancho, riesgo de dilución.
    const brake = this.brakeOf(detail, quote);
    if (brake) {
      this.setPlan(null);
      return this.wait(brake);
    }
    // Sin volumen relativo no se sabe si la acción está "en juego": en vivo el promedio se carga de a poco.
    if (!(detail.row.rvol > 0) && !(detail.row.rvol5m > 0)) {
      this.setPlan(null);
      return this.wait(`${sym}: todavía no hay volumen relativo (el promedio se está cargando); no se entra a ciegas.`);
    }
    const until = this.skip.get(sym);
    if (until && until > now) {
      this.setPlan(null);
      return this.wait(`${sym} se deja pasar hasta las ${formatEtTime(until, false)} (Claude dijo que no, o perdió recién).`);
    }
    // Segunda chance después de un stop: recién a los 90 s y si sostiene el VWAP (dos velas cerradas arriba).
    const sd = this.day.syms[sym];
    if (sd?.lastLossAt && !this.reentryReady(sd, detail)) {
      this.setPlan(null);
      return this.wait(`${sym} perdió hace poco: una segunda chance solo si recupera el VWAP y arma otro setup (${sd.reentries + 1} de ${MAX_REENTRIES}).`);
    }
    // Mientras Claude decide una entrada no se le pregunta otra; si solo está eligiendo candidata o leyendo una indicación, se sigue.
    if (this.state.thinking && this.state.asking !== 'pick' && this.state.asking !== 'instruction') return this.wait(`Consultando a Claude sobre ${this.state.plan?.sym ?? sym}…`);
    // Un tipo de setup que hoy perdió dos veces sin ganar se evita (el agresivo solo lo baja de prioridad);
    // los que dejan afuera tus indicaciones ("hoy solo bull flags") se evitan siempre.
    const daySkip = avoidedSetups(this.day);
    const instrSkip = setupFilter(this.instructions);
    const avoid = new Set<EntryKind>([...daySkip, ...instrSkip]);
    let plan = this.findPlan(detail, quote, r, avoid);
    if (!plan && daySkip.size && this.settings.profile === 'agresivo') plan = this.findPlan(detail, quote, r, instrSkip);
    if (!plan) {
      this.setPlan(null);
      const avoided = [...avoid].map((k) => entryLabel(k).toLowerCase());
      return this.wait(`Esperando un setup limpio en ${sym} (bull flag, micro pullback de 1 min o 10 s, primera vela que hace máximo nuevo, ruptura con volumen; siempre sobre VWAP y EMA 9)${avoided.length ? `; hoy evita ${avoided.join(', ')}` : ''}.`);
    }
    const key = `${sym}:${plan.kind}`;
    let shares = this.size(plan.entry, plan.stop, detail);
    if (key === this.lastPlanKey && now - this.lastPlanAt < this.replan()) {
      const at = formatEtTime(this.lastPlanAt + this.replan(), false);
      this.setPlan({ sym, kind: entryLabel(plan.kind), entry: plan.entry, stop: plan.stop, target: plan.target, shares, note: `se vuelve a considerar a las ${at}` });
      return this.wait(`${entryLabel(plan.kind)} en ${sym}: se vuelve a considerar a las ${at}.`);
    }
    // Con otras posiciones, el riesgo nuevo entra en lo que queda del riesgo abierto del perfil.
    if (busy > 0) {
      if (this.riskBudget(held) < 0.5 * this.risk()) {
        this.setPlan({ sym, kind: entryLabel(plan.kind), entry: plan.entry, stop: plan.stop, target: plan.target, shares, note: 'riesgo abierto al tope: espera que una posición suba el stop' });
        this.missed(sym, plan, `el riesgo abierto estaba al tope del perfil (${r.maxOpenRiskR}R)`);
        this.retryIn(30_000);
        return this.wait(`${sym}: ${entryLabel(plan.kind).toLowerCase()}, pero el riesgo abierto está al tope del perfil (${r.maxOpenRiskR}R): se espera que una posición suba el stop.`);
      }
      const fit = this.fitRisk(plan.entry, plan.stop, shares, held);
      if (fit < shares) {
        this.log(`${sym}: con ${busy} posici${busy === 1 ? 'ón' : 'ones'} abierta${busy === 1 ? '' : 's'}, el tamaño baja de ${shares} a ${fit} para no pasar ${r.maxOpenRiskR}R de riesgo abierto.`, 'info');
        shares = fit;
      }
    }
    this.lastPlanKey = key;
    this.lastPlanAt = now;
    if (shares < 1) {
      const why = this.noBuyingPower();
      this.log(`${sym}: ${entryLabel(plan.kind)} pero no se puede comprar. ${why}`, 'error');
      this.missed(sym, plan, why);
      this.retryIn(30_000);
      this.setPlan(null);
      return this.wait(`${sym}: ${why}`);
    }
    const second = !!sd?.lastLossAt;
    const text = `Comprar ${shares} a $${px(plan.entry)}, stop $${px(plan.stop)} (riesgo $${((plan.entry - plan.stop) * shares).toFixed(0)}), objetivo $${px(plan.target)}. ${plan.reason}.${second ? ' Segunda chance después del stop.' : ''}`;
    if (this.settings.mode === 'suggest') {
      this.setPlan({ sym, kind: entryLabel(plan.kind), entry: plan.entry, stop: plan.stop, target: plan.target, shares, note: 'esperando tu decisión' });
      this.suggest({ kind: 'entry', sym, title: `${second ? 'Segunda chance: ' : ''}${entryLabel(plan.kind)} en ${sym}`, text, plan, shares });
      if (this.settings.consult && !this.state.thinking && this.canAsk()) void this.askEntry(detail, plan, shares, false);
      return this.wait('');
    }
    // El perfil Ross entra en el segundo en que aparece el setup: Claude no se consulta antes (opina después, si se le pregunta).
    if (this.settings.consult && r.askBeforeEntry > 0 && this.canAsk()) {
      this.log(`${sym}: ${entryLabel(plan.kind)} a $${px(plan.entry)} (stop $${px(plan.stop)}): le pregunto a Claude.`, 'info');
      this.setPlan({ sym, kind: entryLabel(plan.kind), entry: plan.entry, stop: plan.stop, target: plan.target, shares, note: 'consultando a Claude' });
      void this.askEntry(detail, plan, shares, true);
      return this.wait(`Consultando a Claude sobre ${sym}…`);
    }
    // Sin Claude (no hay IA o se acabó el cupo del día): las reglas alcanzan para operar.
    this.wait('');
    this.execute(sym, plan, shares, 'reglas');
  }

  /** ¿Hay algo que frena la entrada en esta acción? Lo cuenta en la memoria del día (una vez por episodio) y lo explica. */
  private brakeOf(detail: SymbolDetail, quote: ReturnType<DataSource['quote']>): string {
    const sym = detail.sym;
    const ask = quote?.ask || detail.row.ask || detail.row.price;
    const bid = quote?.bid || detail.row.bid || detail.row.price;
    const spread = ask > 0 && bid > 0 ? (ask - bid) / ask : 0;
    const cand = this.state.candidates.find((c) => c.sym === sym);
    const dilution = cand?.warnings.find((w) => /dilución/.test(w));
    let what = '';
    let text = '';
    if (detail.row.halted || quote?.halted) {
      what = 'halt';
      text = `${sym} está en halt: se espera la reanudación.`;
    } else if (spread > 0.02) {
      what = 'spread';
      text = `${sym}: spread de ${(spread * 100).toFixed(1)} % (más de 2 %): se espera que se cierre.`;
    } else if (dilution && !this.dilutionCounted.has(sym)) {
      // La dilución no frena sola (ya resta puntos en el ranking), pero cuenta como freno del día (una vez).
      this.dilutionCounted.add(sym);
      this.brake(sym, 'dilución');
      return '';
    }
    if (what) {
      this.brake(sym, what);
      return text;
    }
    const d = this.day.syms[sym];
    if (d && d.lastBrake) d.lastBrake = '';
    return '';
  }

  /** Cuenta un freno en la memoria del día (el mismo freno seguido cuenta una sola vez). */
  private brake(sym: string, what: string): void {
    const d = symDay(this.day, sym);
    if (d.lastBrake === what) return;
    d.lastBrake = what;
    d.brakes++;
    if (d.brakes === 2) this.log(`${sym}: segundo freno de hoy (${what}); baja 15 puntos en el ranking.`, 'info');
  }

  /** Segunda chance: pasaron 90 s desde el stop y las dos últimas velas de 1 min cerraron sobre el VWAP. */
  private reentryReady(sd: SymDay, detail: SymbolDetail): boolean {
    if (this.now - sd.lastLossAt < REENTRY_WAIT) return false;
    const closed = detail.bars.slice(-3, -1);
    const vwap = detail.row.vwap;
    return closed.length >= 2 && vwap > 0 && closed.every((b) => b.c > vwap);
  }

  private rank(): void {
    if (!this.view) return;
    const avoid = avoidedSyms(this.instructions);
    // Las que pediste ("mirá DEF", un nivel) entran con su fila del motor aunque no estén en ningún escáner.
    const forced = watchedSyms(this.instructions);
    const rows = [...Object.values(this.view.scanners).flat(), ...this.view.watch];
    const have = new Set(rows.map((x) => x.sym));
    for (const sym of forced) {
      if (have.has(sym)) continue;
      const row = this.view.tracked.find((x) => x.sym === sym) ?? this.source?.row(sym) ?? null;
      if (row) {
        rows.push(row);
        have.add(sym);
      }
    }
    const ranked = rankCandidates(rows, this.scanSettings, forced).filter((c) => !avoid.has(c.sym));
    // Memoria del día: una acción con 2 frenos o 2 perdedores hoy baja 15 puntos.
    for (const c of ranked) {
      if (forced.has(c.sym) && c.score < this.settings.rules.minScore) c.score = this.settings.rules.minScore;
      if (!penalized(this.day, c.sym)) continue;
      const d = this.day.syms[c.sym];
      c.score = Math.max(0, c.score - 15);
      c.warnings.push(d.losers >= 2 ? `${d.losers} perdedores hoy` : `${d.brakes} frenos hoy`);
    }
    this.state.candidates = ranked.sort((a, b) => b.score - a.score || b.row.rvol - a.row.rvol).slice(0, 8);
    const top = this.state.candidates[0];
    if (this.settings.mode === 'suggest' && top && top.score >= this.settings.rules.minScore + 10 && top.sym !== this.lastTop) {
      this.lastTop = top.sym;
      this.suggest({ kind: 'pick', sym: top.sym, title: `Mirá ${top.sym}`, text: `${top.reasons.join(', ')}${top.warnings.length ? ` · ojo: ${top.warnings.join(', ')}` : ''}.` });
    }
    this.emit();
  }

  private limits(): string {
    const r = this.rules();
    const trades = this.c.active?.trades.length ?? 0;
    if (trades >= r.maxTrades) return `Ya hubo ${trades} trades hoy: por hoy no se abren más${r.maxTrades < this.settings.rules.maxTrades ? ' (el tope que pediste)' : ''}.`;
    const losers = this.losersInARow();
    if (losers >= r.maxLosers) return `${losers} perdedores seguidos: Ross para por hoy. Mañana se vuelve a empezar.`;
    const sum = this.c.summary();
    const loss = -sum.dayPnl;
    const max = r.maxLossR * this.risk();
    if (loss >= max) return `Pérdida del día de $${loss.toFixed(0)} (${r.maxLossR}R): no se abren más trades hoy.`;
    // El bróker rechaza el cuarto day trade con menos de US$ 25.000 en cuenta margen: mejor avisarlo antes.
    if (sum.pdt && sum.dayTrades >= 3) return 'Regla PDT: ya hay 3 day trades en 5 días con menos de US$ 25.000 en cuenta margen. Para practicar sin ese freno: en Preferencias de práctica subí el saldo a US$ 25.000 o desactivá "Regla PDT".';
    if (etParts(this.now).minutes >= MARKET_CLOSE) return 'Cerró el mercado (16:00 NY): por hoy no se abren más trades.';
    return '';
  }

  /** Por qué no alcanza el poder de compra (y qué tocar en Preferencias para practicar seguido). */
  private noBuyingPower(): string {
    const sum = this.c.summary();
    const s = this.c.state.settings;
    const bp = `poder de compra ${fmtMoney(sum.buyingPower)}`;
    if (s.account === 'cash' && sum.unsettled > 0) return `Sin ${bp}: en cuenta cash lo vendido hoy (${fmtMoney(sum.unsettled)}) se libera mañana (T+1). Para practicar seguido: cuenta margen con US$ 25.000 o más, o desactivá "Liquidación T+1" en Preferencias de práctica.`;
    return `Sin ${bp} para el tamaño por riesgo (o la acción no tiene liquidez): revisá el saldo y el riesgo por trade en Preferencias de práctica.`;
  }

  /** Dice por qué no entra ahora (se ve en el panel) sin llenar el registro. */
  private wait(reason: string): void {
    if (this.state.waiting !== reason) {
      this.state.waiting = reason;
      this.emit();
    }
  }

  /** Cuánto se espera para volver a considerar el mismo plan tras un "esperar" de Claude: el agresivo, 90 s. */
  private replan(): number {
    return this.settings.profile === 'agresivo' ? 90_000 : PLAN_RETRY;
  }

  /** El mismo plan se vuelve a mirar en `ms` (en vez de los 3 minutos de un "esperar" de Claude). */
  private retryIn(ms: number): void {
    this.lastPlanAt = this.now - this.replan() + ms;
  }

  private async askPick(cands: Candidate[]): Promise<void> {
    try {
      const d = await this.ask(pickPrompt(cands, this.now, this.brief(), this.instrBlock()), 'pick');
      if (!d) return;
      this.state.advice = { ts: this.now, sym: d.sym ?? '', decision: d.decision, text: d.reason };
      this.note({ at: this.now, sym: d.sym ?? '', kind: 'pick', decision: d.decision, confidence: d.confidence, reason: d.reason });
      this.log(`Claude elige ${d.sym ?? 'ninguna'}: ${d.reason}`, 'ai');
      if (d.sym && cands.some((x) => x.sym === d.sym) && d.sym !== this.state.focus && !this.positions().includes(d.sym) && !this.pending.has(d.sym)) this.focusOn(d.sym, 'Claude');
    } catch (e) {
      this.log(`Claude no respondió: ${(e as Error).message}`, 'error');
    }
  }

  private async askEntry(detail: SymbolDetail, plan: EntryPlan, shares: number, execute: boolean): Promise<void> {
    const sym = detail.sym;
    try {
      const d = await this.ask(entryPrompt(detail, this.source?.quote(sym) ?? null, plan, shares, this.now, this.brief(), this.bookOf(sym), this.instrBlock()), 'entry');
      if (!d) {
        this.log('Claude respondió algo que no se entiende.', 'error');
        return;
      }
      this.state.advice = { ts: this.now, sym, decision: d.decision, text: d.reason };
      this.note({ at: this.now, sym, kind: 'entry', decision: d.decision, confidence: d.confidence, reason: d.reason, stop: d.stop, target: d.target });
      const verdict = d.decision === 'enter' ? 'entra' : d.decision === 'wait' ? 'espera' : 'no entra';
      this.log(`Claude ${verdict}${d.confidence !== undefined ? ` (${d.confidence} %)` : ''}: ${d.reason}`, 'ai');
      if (!execute) return;
      // Las reglas mandan (salvo en el perfil conservador): un "esperar" de Claude sin mucha convicción no
      // frena la entrada; solo un "no" (skip) o un "esperar" muy seguro (70 % o más) la vetan.
      let decision = d.decision;
      if (decision === 'wait' && this.settings.profile !== 'conservador' && (d.confidence ?? 0) < 70) {
        this.log(`${sym}: el perfil ${PROFILE_LABEL[this.settings.profile].toLowerCase()} entra igual (Claude dudaba sin un motivo fuerte).`, 'info');
        decision = 'enter';
      }
      if (decision === 'enter') {
        // Mientras Claude pensaba el precio siguió: si hay un plan fresco en la misma acción se usa ese;
        // si no, se entra igual mientras no se haya ido más de 3 % ni caído debajo del stop (un runner no
        // espera a nadie). Más lejos que eso, se escapó: se vuelve a mirar en 30 s.
        const q = this.source?.quote(sym);
        const ask = q?.ask ?? plan.entry;
        const fresh = this.detailOf(sym);
        const again = fresh ? this.findPlan(fresh, q ?? null, this.rules(), setupFilter(this.instructions)) : null;
        let live = plan;
        if (again && again.entry <= plan.entry * 1.03) live = again;
        else if (ask <= plan.entry * 1.03 && ask > plan.stop) live = { ...plan, entry: roundPx(ask), target: roundPx(ask + this.settings.rules.targetR * (ask - plan.stop)) };
        else {
          this.log(`${sym}: se escapó mientras Claude pensaba (ask $${px(ask)}, entrada $${px(plan.entry)}): se espera el próximo descanso.`, 'info');
          this.missed(sym, plan, `se escapó mientras Claude pensaba (ask $${px(ask)})`);
          this.setPlan(null);
          this.retryIn(30_000);
          return;
        }
        // Con el stop que propone Claude cambia el riesgo por acción: el tamaño se recalcula. El objetivo es
        // el de Claude si paga lo que pide el perfil; si queda corto, se sube al del perfil (Claude dijo que
        // entremos: su stop y su objetivo son consejos, no un motivo para dejar pasar el trade).
        const stop = d.stop && d.stop < live.entry && d.stop > live.entry * 0.93 ? d.stop : live.stop;
        const risk = live.entry - stop;
        const minR = this.settings.rules.minRewardR;
        const floor = roundPx(live.entry + Math.max(minR, this.settings.rules.targetR) * risk);
        let target = d.target && d.target > live.entry ? d.target : Math.max(live.target, plan.target);
        if (target < live.entry + minR * risk - 1e-9) {
          this.log(`${sym}: el objetivo $${px(target)} no paga ${minR}R con el stop en $${px(stop)}: se apunta a $${px(floor)} (${this.settings.rules.targetR}R).`, 'info');
          target = floor;
        }
        const sized = this.fitRisk(live.entry, stop, this.size(live.entry, stop, detail));
        if (sized < 1) {
          const why = this.noBuyingPower();
          this.log(`${sym}: con el stop en $${px(stop)} no se puede comprar. ${why}`, 'error');
          this.missed(sym, { ...live, stop }, why);
          this.setPlan(null);
          this.retryIn(30_000);
          return;
        }
        this.execute(sym, { ...live, stop, target }, sized, 'Claude');
      } else if (decision === 'skip') {
        this.brake(sym, 'claude');
        this.skip.set(sym, this.now + 10 * 60_000);
        this.missed(sym, plan, `Claude dijo que no${d.confidence !== undefined ? ` (${d.confidence} %)` : ''}: ${d.reason}`);
        this.setPlan(null);
      } else {
        // "Esperar": el mismo plan se vuelve a considerar a los 3 min (no a los 60 s).
        this.missed(sym, plan, `Claude pidió esperar${d.confidence !== undefined ? ` (${d.confidence} %)` : ''}: ${d.reason}`);
        this.lastPlanAt = this.now;
      }
    } catch (e) {
      // Sin respuesta: en equilibrado y agresivo mandan las reglas y se entra igual; el conservador espera
      // el visto bueno de Claude y vuelve a mirar el setup en 30 s.
      if (execute && this.settings.profile !== 'conservador') {
        this.log(`Claude no respondió: ${(e as Error).message}. Las reglas ya vieron el setup: se entra igual.`, 'error');
        this.execute(sym, plan, shares, 'reglas (Claude no respondió)');
        return;
      }
      this.log(`Claude no respondió: ${(e as Error).message}. No se entra sin su opinión; se vuelve a mirar en 30 s.`, 'error');
      this.setPlan(null);
      this.retryIn(30_000);
    }
  }

  private execute(sym: string, plan: EntryPlan, shares: number, by: string, opts: { add?: boolean } = {}): void {
    // La IA opera solo comprada: con un corto abierto a mano en esa acción, una compra lo cubriría.
    const pos = this.c.broker?.position(sym);
    if (pos?.side === 'short') {
      this.log(`${sym}: tenés un corto abierto; la IA no compra (lo cubriría).`, 'info');
      return;
    }
    if (this.avoided(sym)) {
      this.log(`${sym}: tu indicación dice que hoy no se opera; no se compra.`, 'info');
      return;
    }
    // Nunca dos veces la misma acción (salvo para agregar a la ganadora).
    if (!opts.add && (pos || this.pending.has(sym))) {
      this.log(`${sym}: ya hay una posición (o una compra en curso); no se abre otra.`, 'info');
      return;
    }
    if (opts.add && !pos) return;
    const q = this.source?.quote(sym);
    const ask = q?.ask ?? plan.entry;
    const price = roundPx(Math.min(ask + 0.05, plan.entry * 1.012));
    const res = this.c.place({ sym, side: 'buy', type: 'limit', price, shares, tif: 'DAY+', route: 'SMRT', stop: plan.stop, target: plan.target, setup: `IA · ${entryLabel(plan.kind)}` });
    if (!res.ok) {
      this.log(`${sym}: no se pudo comprar (${res.message}).`, 'error');
      return;
    }
    this.setPlan(null);
    this.pending.set(sym, { orderId: res.order?.id ?? '', since: this.now, add: !!opts.add });
    if (opts.add && pos) {
      const mem = this.mem.get(sym) ?? newMemory(pos.openedAt, pos.avgCost);
      this.mem.set(sym, mem);
      mem.addedOnce = true;
      // El stop de toda la posición sube al del setup nuevo (la orden, si hay, y el dinámico de la IA).
      mem.stop = Math.max(mem.stop ?? 0, plan.stop);
      if (pos.stop) this.c.setBracket(sym, plan.stop, pos.target);
      this.step_(sym, 'agrega', `${shares} a $${px(price)}: ${entryLabel(plan.kind).toLowerCase()}, el stop de toda la posición sube a $${px(plan.stop)}`, by);
      this.log(`${sym}: agrega ${shares} a $${px(price)} (${by}): ${entryLabel(plan.kind).toLowerCase()}, el stop de toda la posición sube a $${px(plan.stop)}.`, 'ok');
      return;
    }
    const sd = this.day.syms[sym];
    const second = !!sd?.lastLossAt;
    const mem = newMemory(this.now, price, plan.kind, shares);
    if (second) {
      sd.reentries++;
      sd.lastLossAt = 0;
      mem.secondChance = true;
    }
    this.mem.set(sym, mem);
    this.setPhase(this.positions().length ? 'inPosition' : 'entering');
    const claude = this.claudeNotes.get(sym);
    this.claudeNotes.delete(sym);
    this.journal.trades.push({ id: ++this.seq, sym, kind: entryLabel(plan.kind), by, at: this.now, entry: price, stop: plan.stop, target: plan.target, shares, reason: plan.reason, secondChance: second, ctx: this.contextOf(sym, price, shares), claude: claude && this.now - claude.at < 120_000 ? claude : undefined, steps: [] });
    this.journalDirty = true;
    this.log(`${second ? `Segunda chance en ${sym}: compra` : 'Compra'} ${shares} ${sym} a $${px(price)} (${by}): ${entryLabel(plan.kind)}, stop $${px(plan.stop)}, objetivo $${px(plan.target)}.`, 'ok');
    if (plan.kind === 'level') this.fulfilLevel(sym);
    if (this.settings.follow) this.onSelect(sym);
  }

  private managePosition(sym: string): void {
    const pos = this.c.broker?.position(sym);
    if (!pos || pos.side === 'short') return;
    let mem = this.mem.get(sym);
    if (!mem) {
      mem = newMemory(pos.openedAt, pos.avgCost, undefined, pos.boughtShares);
      this.mem.set(sym, mem);
    }
    const detail = this.detailOf(sym);
    if (!detail) return;
    // La mitad cuenta como tomada cuando se ejecutó la venta, no cuando se mandó.
    if (pos.soldShares > 0) mem.halfTaken = true;
    const quote = this.source!.quote(sym);
    const advice = manage(pos, detail, quote, this.now, mem, this.settings.rules);
    if (advice.action === 'hold') {
      // Agregar a la ganadora: con la mitad tomada y el stop en la entrada, otro setup limpio en la misma acción.
      if (!this.pending.has(sym) && inEntryWindow(this.now, this.rules()) && !this.limits()) {
        const add = findAdd(pos, detail, quote, this.now, mem, this.rules(), this.risk(), this.c.summary().buyingPower, this.liquidity(detail));
        if (add) {
          if (this.settings.mode === 'auto') this.execute(sym, add.plan, add.shares, 'reglas', { add: true });
          else this.suggest({ kind: 'entry', sym, title: `Agregá ${add.shares} a ${sym}`, text: `${entryLabel(add.plan.kind)} a $${px(add.plan.entry)}: el stop de toda la posición sube a $${px(add.plan.stop)}. ${add.plan.reason}.`, plan: add.plan, shares: add.shares, add: true });
        }
      }
      return;
    }
    const last = this.lastExit.get(sym);
    if (last && advice.action === last.action && this.now - last.at < 20_000) return;
    this.lastExit.set(sym, { action: advice.action, at: this.now });
    if (this.settings.mode === 'auto') this.applyExit(sym, advice, 'reglas');
    else this.suggest({ kind: 'exit', sym, title: advice.action === 'sellHalf' ? `Vendé la mitad de ${sym}` : advice.action === 'sellAll' ? `Vendé ${sym}` : `Stop a la entrada en ${sym}`, text: `${advice.reason}.`, exit: advice });
  }

  /** Anota un paso del manejo en el informe (sobre el último trade abierto de esa acción). */
  private step_(sym: string, action: string, reason: string, by: string): void {
    const t = this.journal.trades.filter((x) => x.sym === sym && !x.exit).at(-1);
    if (!t) return;
    t.steps.push({ at: this.now, action, reason, by });
    this.journalDirty = true;
  }

  private applyExit(sym: string, advice: ExitAdvice, by: string): void {
    const pos = this.c.broker?.position(sym);
    // Solo sobre una posición comprada: `sell` nunca abre un corto, pero tampoco hay que cubrir uno ajeno.
    if (!pos || pos.side === 'short') return;
    const mem = this.mem.get(sym) ?? newMemory(pos.openedAt, pos.avgCost);
    this.mem.set(sym, mem);
    if (advice.action === 'sellHalf') {
      // Si ya hay una venta (la del objetivo o una anterior) esperando en el mercado, no se duplica.
      if (this.c.broker?.orders(sym).some((o) => o.side === 'sell' && (o.role === 'target' || o.role === 'exit') && LIVE.has(o.status))) return;
      const res = this.c.sell(sym, 0.5, 'bid', -0.05, undefined, advice.role);
      this.step_(sym, 'vende la mitad', advice.reason, by);
      this.log(`${sym}: vende la mitad (${by}). ${advice.reason}.`, res.ok ? 'ok' : 'error');
    } else if (advice.action === 'sellAll') {
      // Las órdenes que quedaban (stop, objetivo, una venta anterior, una compra para agregar) se cancelan antes de vender todo.
      this.c.cancelAll(sym);
      this.pending.delete(sym);
      // La venta queda anotada como "stop" u "objetivo" en Mis trades (no como venta manual) según la regla que la disparó.
      const res = this.c.sell(sym, 1, 'bid', -0.05, undefined, advice.role);
      this.step_(sym, 'vende todo', advice.reason, by);
      this.log(`${sym}: vende todo (${by}). ${advice.reason}.`, res.ok ? 'ok' : 'error');
    } else if (advice.action === 'stopToBreakeven') {
      mem.breakeven = true;
      if (pos.stop) this.c.setBracket(sym, pos.avgCost, pos.target);
      this.step_(sym, 'stop a la entrada', advice.reason, by);
      this.log(`${sym}: stop a la entrada ($${px(pos.avgCost)}). ${advice.reason}.`, 'info');
    }
  }

  /** Cerró un trade (o se canceló la compra sin ejecutarse): se anota en la memoria del día y se olvida la posición. */
  private afterTrade(sym: string): void {
    const mem = this.mem.get(sym);
    const trades = this.c.active?.trades ?? [];
    const t = trades.filter((x) => x.sym === sym).at(-1);
    if (t && mem && t.closedAt >= mem.enteredAt) {
      this.log(`${sym} cerrado: ${t.net >= 0 ? '+' : '−'}$${Math.abs(t.net).toFixed(2)}${t.r !== undefined ? ` (${t.r.toFixed(1)}R)` : ''}.`, t.net >= 0 ? 'ok' : 'error');
      const rec = this.journal.trades.filter((x) => x.sym === sym && !x.exit).at(-1);
      if (rec) {
        rec.exit = { at: t.closedAt, avgExit: t.avgExit, net: t.net, r: t.r, reason: t.exitReason, mfePct: t.mfePct, maePct: t.maePct, minutes: (t.closedAt - t.openedAt) / 60_000 };
        this.journalDirty = true;
      }
      this.remember(sym, t, mem.kind);
      if (t.net < 0) {
        const sd = symDay(this.day, sym);
        // Después de perder no se vuelve a la misma acción enseguida (revancha no es un setup): el
        // conservador la deja 5 min; los otros perfiles le dan hasta dos segundas chances si recupera el VWAP.
        if (this.settings.profile !== 'conservador' && sd.reentries < MAX_REENTRIES) sd.lastLossAt = this.now;
        else {
          sd.lastLossAt = 0;
          this.skip.set(sym, this.now + LOSER_SKIP);
        }
      }
    }
    this.mem.delete(sym);
    this.pending.delete(sym);
    this.lastExit.delete(sym);
    this.cooldownUntil = this.now + COOLDOWN;
    this.lastPlanAt = this.now;
    // Se vuelve a elegir la mejor candidata desde cero (la que miraba mientras tanto puede no ser la mejor ahora).
    this.focusOn(null);
    if (!this.positions().length && !this.pending.size) this.setPhase('scanning');
  }

  /** Anota el resultado de un trade en la memoria del día (por acción y por tipo de setup). */
  private remember(sym: string, t: Trade, kind?: EntryKind): void {
    const r = t.r ?? 0;
    const win = t.net > 0;
    const sd = symDay(this.day, sym);
    sd.trades++;
    sd.netR += r;
    if (win) sd.wins++;
    else sd.losers++;
    this.day.trades++;
    this.day.netR += r;
    if (win) this.day.wins++;
    if (kind) {
      const k = (this.day.setups[kind] ??= { trades: 0, wins: 0, losers: 0, netR: 0 });
      k.trades++;
      k.netR += r;
      if (win) k.wins++;
      else k.losers++;
      if (!win && k.losers === 2 && k.wins === 0) this.log(`${entryLabel(kind)}: dos perdedores hoy sin ganar ninguna; ${this.settings.profile === 'agresivo' ? 'baja de prioridad' : 'se evita el resto del día'}.`, 'info');
    }
    if (sd.losers === 2) this.log(`${sym}: dos perdedores hoy; baja 15 puntos en el ranking.`, 'info');
  }

  /** Al terminar el día, Claude lo resume en 4 o 5 frases (una sola vez por día, dentro del presupuesto). */
  private async summarizeDay(dayId: string, trades: Trade[]): Promise<void> {
    if (!dayId || dayId === this.summarizedDay || !trades.length || !this.settings.consult || !this.canAsk()) return;
    this.summarizedDay = dayId;
    const log = this.state.log.map((l) => `${formatEtTime(l.ts, false)} ${l.text}`);
    try {
      const text = await this.askRaw(dayPrompt({ profile: PROFILE_LABEL[this.settings.profile].toLowerCase(), trades, log }, this.now || Date.now(), this.brief()), 'summary');
      const summary = parseSummary(text);
      if (!summary) return this.log('Claude no pudo resumir el día.', 'error');
      this.state.daySummary = summary;
      const j = this.journal.sessionId === dayId ? this.journal : this.prevJournal?.sessionId === dayId ? this.prevJournal : null;
      if (j) {
        j.summary = summary;
        if (this.persistInstr) save(j === this.journal ? 'ai-journal' : 'ai-journal-prev', j);
      }
      this.log(`Resumen del día (Claude): ${summary}`, 'ai');
    } catch (e) {
      this.log(`Claude no resumió el día: ${(e as Error).message}`, 'error');
    }
    this.emit();
  }
}

/** Redondea hacia abajo a un lote cómodo (como `sizeFor`). */
function lots(shares: number): number {
  const lot = shares >= 1000 ? 100 : shares >= 100 ? 10 : 1;
  return Math.max(0, Math.floor(shares / lot) * lot);
}

/** Re-renderiza cuando el IA Trader cambia algo. */
export function useAiVersion(t: AiTrader): number {
  const [v, setV] = useState(0);
  useEffect(() => t.subscribe(() => setV((x) => x + 1)), [t]);
  return v;
}
