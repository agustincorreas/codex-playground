// El IA Trader: mira los escáneres como un trader de momentum, elige "la obvia", la sigue de cerca
// (velas, VWAP, EMA 9, cinta), entra con stop y objetivo 2:1, maneja la posición y sale. En modo
// "sugerencias" te propone cada paso y vos decidís; en "automático" opera solo la cuenta de práctica.
// Claude, si está disponible, opina antes de cada entrada (y elige entre las candidatas).
import { DEFAULT_SETTINGS, type Settings, type SymbolDetail, type ViewModel } from '../engine/types';
import { formatEtTime } from '../engine/time';
import { fmtMoney } from './lib/format';
import { ADVISOR_SYSTEM, entryPrompt, exitPrompt, parseDecision, pickPrompt, type AccountBrief } from '../trading/advisor';
import { roundPx } from '../trading/depth';
import { DEFAULT_RULES, entryLabel, findEntry, inEntryWindow, manage, newMemory, PROFILE_LABEL, PROFILES, profileOf, rankCandidates, sizeFor, type AiProfile, type Candidate, type EntryPlan, type ExitAdvice, type PlaybookRules, type PositionMemory } from '../trading/playbook';
import { aiAvailable, type Asker } from './lib/ai';
import { load, save } from './lib/storage';
import type { DataSource } from './source/types';
import type { TrainingController } from './training';
import type { Order } from '../trading/types';
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
}

export type AiPhase = 'off' | 'scanning' | 'watching' | 'entering' | 'inPosition' | 'paused';

export interface AiAdvice {
  ts: number;
  sym: string;
  decision: string;
  text: string;
}

export interface AiState {
  phase: AiPhase;
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
  /** Qué se le está preguntando a Claude ahora (una entrada bloquea otra entrada; elegir candidata, no). */
  asking?: 'pick' | 'entry' | 'exit' | 'now';
}

const DEFAULT_AI: AiSettings = { mode: 'off', consult: true, follow: true, rules: DEFAULT_RULES, profile: 'equilibrado', maxCalls: 120 };
const px = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const ASK_TIMEOUT = 25_000;
/** Una compra que no se ejecutó en este tiempo se cancela (si se ejecutó en parte, se cancela el resto). */
const PENDING_TIMEOUT = 25_000;
/** Claude elige entre las candidatas como mucho cada 2 min (y solo si cambiaron o no hay foco). */
const PICK_EVERY = 120_000;
/** El mismo plan en la misma acción se vuelve a considerar a los 3 min (también si Claude dijo "esperar"). */
const PLAN_RETRY = 180_000;
/** Después de salir de un trade no se busca otro por 20 s; de una salida perdedora, no se vuelve a esa acción por 5 min. */
const COOLDOWN = 20_000;
const LOSER_SKIP = 5 * 60_000;
// El objetivo mínimo en R, el puntaje mínimo y el multiplicador del riesgo salen del perfil (settings.rules).
const LIVE: ReadonlySet<Order['status']> = new Set(['sent', 'open', 'partial']);

export class AiTrader {
  settings: AiSettings;
  state: AiState = { phase: 'off', focus: null, since: 0, candidates: [], suggestion: null, advice: null, log: [], calls: 0, pausedReason: '', waiting: '', ai: '?', thinking: false };
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
  private mem = new Map<string, PositionMemory>();
  private skip = new Map<string, number>();
  private lastPlanKey = '';
  private lastPlanAt = 0;
  /** La acción del trade en curso, la orden de compra mandada y cuándo. */
  private pendingSym = '';
  private pendingOrderId = '';
  private pendingSince = 0;
  private cooldownUntil = 0;
  private lastExit = { action: '', at: 0 };
  private lastSuggestKey = '';
  private sessionId = '';
  /** Día (del reloj real) al que corresponden las consultas contadas. */
  private callsDay = '';
  private budgetWarned = false;
  private now = 0;

  constructor(
    private readonly c: TrainingController,
    private readonly onSelect: (sym: string) => void,
  ) {
    const saved = load<Partial<AiSettings>>('ai-settings', {});
    this.settings = { ...DEFAULT_AI, ...saved, rules: { ...DEFAULT_RULES, ...(saved.rules ?? {}) } };
    this.settings.profile = profileOf(this.settings.rules);
    this.state.phase = this.settings.mode === 'off' ? 'off' : 'scanning';
    void aiAvailable().then((ai) => {
      this.asker = ai?.ask ?? null;
      this.state.ai = ai ? ai.via : 'no';
      this.emit();
    });
    // Otro día, otra cuenta (recargada o importada): lo que la IA recordaba ya no vale.
    c.onDayChange(() => this.reset());
  }

  /** Vuelve al principio: sin foco, sin memoria de posiciones ni de planes (al cambiar de día o de cuenta). */
  reset(): void {
    this.mem.clear();
    this.skip.clear();
    this.cooldownUntil = 0;
    this.pendingSym = '';
    this.pendingOrderId = '';
    this.pendingSince = 0;
    this.lastPlanKey = '';
    this.lastPlanAt = 0;
    this.lastPickKey = '';
    this.lastPick = 0;
    this.lastRank = 0;
    this.lastTop = '';
    this.lastExit = { action: '', at: 0 };
    this.lastSuggestKey = '';
    this.sessionId = '';
    this.state.candidates = [];
    this.state.suggestion = null;
    this.state.advice = null;
    this.focusOn(null);
    if (this.state.phase !== 'off') this.setPhase('scanning');
    this.emit();
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
    if (this.state.focus) source.focus?.(this.state.focus);
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
      } else if (this.state.phase === 'off') this.setPhase('scanning');
      this.log(patch.mode === 'off' ? 'IA Trader apagado.' : patch.mode === 'auto' ? 'Modo automático: opera solo la cuenta de práctica.' : 'Modo sugerencias: propone y vos decidís.', 'info');
    }
    this.emit();
  }

  private profileSummary(): string {
    const r = this.settings.rules;
    const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    return `entradas de ${hhmm(r.entryFrom)} a ${hhmm(r.entryTo)}, hasta ${r.maxTrades} trades, ${r.maxLosers} perdedores o ${r.maxLossR}R, riesgo ×${r.riskMult}, candidatas de ${r.minScore}+, objetivo ${r.targetR}:1.`;
  }

  /** Riesgo por trade de este perfil: el de la cuenta por el multiplicador del perfil. */
  private risk(): number {
    return this.c.riskAmount() * this.settings.rules.riskMult;
  }

  private log(text: string, tone: AiLogEntry['tone'] = 'info'): void {
    this.state.log = [...this.state.log.slice(-59), { id: ++this.seq, ts: this.now || Date.now(), text, tone }];
    this.emit();
  }

  private setPhase(phase: AiPhase, reason = ''): void {
    if (this.state.phase !== phase || this.state.pausedReason !== reason) {
      this.state.phase = phase;
      this.state.pausedReason = reason;
      this.state.since = this.now;
      this.emit();
    }
  }

  private focusOn(sym: string | null, why?: string): void {
    if (sym === this.state.focus) return;
    this.state.focus = sym;
    this.state.since = this.now;
    this.source?.focus?.(sym);
    if (sym) {
      const cand = this.state.candidates.find((x) => x.sym === sym);
      this.log(`Mirando ${sym}${why ? ` (${why})` : ''}${cand ? `: ${cand.reasons.join(', ')}` : ''}.`);
      if (this.settings.follow && this.settings.mode === 'auto') this.onSelect(sym);
    }
    this.emit();
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
    else if (s.kind === 'entry' && s.plan && s.shares) this.execute(s.sym, s.plan, s.shares, 'tu decisión');
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

  private async ask(prompt: string, kind: AiState['asking'] = 'now'): Promise<ReturnType<typeof parseDecision>> {
    if (!this.asker) return null;
    this.rollCalls();
    this.state.thinking = true;
    this.state.asking = kind;
    this.state.calls++;
    this.emit();
    try {
      const text = await Promise.race([this.asker(ADVISOR_SYSTEM, prompt), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('Claude tardó más de 25 s')), ASK_TIMEOUT))]);
      return parseDecision(text);
    } finally {
      this.state.thinking = false;
      this.state.asking = undefined;
      this.emit();
    }
  }

  /** Preguntarle a Claude ahora mismo por lo que está mirando (o por la posición abierta). */
  async askNow(): Promise<void> {
    if (!this.asker || !this.source) return;
    const now = this.now || Date.now();
    const held = this.positions();
    try {
      if (held.length) {
        const sym = this.pendingSym && held.includes(this.pendingSym) ? this.pendingSym : held[0];
        const pos = this.c.broker!.position(sym)!;
        const detail = this.detailOf(sym);
        if (!detail) return;
        const d = await this.ask(exitPrompt(detail, this.source.quote(sym), pos, this.mem.get(sym) ?? newMemory(pos.openedAt, pos.avgCost), now, this.brief()));
        if (d) this.state.advice = { ts: now, sym, decision: d.decision, text: d.reason };
      } else if (this.state.focus) {
        const detail = this.detailOf(this.state.focus);
        if (!detail) return;
        const plan = findEntry(detail, this.source.quote(detail.sym), now, this.settings.rules);
        const shares = plan ? sizeFor(this.risk(), plan.entry, plan.stop, this.c.summary().buyingPower, this.liquidity(detail)) : 0;
        const d = plan && shares > 0 ? await this.ask(entryPrompt(detail, this.source.quote(detail.sym), plan, shares, now, this.brief())) : await this.ask(pickPrompt(this.state.candidates, now, this.brief()));
        if (d) this.state.advice = { ts: now, sym: d.sym ?? detail.sym, decision: d.decision, text: d.reason };
      } else if (this.state.candidates.length) {
        const d = await this.ask(pickPrompt(this.state.candidates, now, this.brief()));
        if (d) this.state.advice = { ts: now, sym: d.sym ?? '', decision: d.decision, text: d.reason };
      }
      if (this.state.advice) this.log(`Claude: ${this.state.advice.text}`, 'ai');
    } catch (e) {
      this.log(`Claude no respondió: ${(e as Error).message}`, 'error');
    }
    this.emit();
  }

  /** Volumen por minuto para no comprar más del 10 % de lo que opera: lo mayor entre la cotización y los últimos 5 min. */
  private liquidity(detail: SymbolDetail): number {
    return Math.max(this.source?.quote(detail.sym)?.volPerMin ?? 0, detail.row.vol5m / 5, detail.bars.slice(-3).reduce((v, b) => v + b.v, 0) / 3);
  }

  private detailOf(sym: string): SymbolDetail | null {
    const d = this.source?.focusDetail?.();
    return d && d.sym === sym ? d : null;
  }

  /** Acciones con posición de verdad (las órdenes vivas solas no cuentan). */
  /** Posiciones que maneja la IA: solo las compradas (los cortos que abra el usuario a mano no son de ella). */
  private positions(): string[] {
    return this.c.broker?.session.positions.filter((p) => p.side !== 'short').map((p) => p.sym) ?? [];
  }

  /** La compra mandada por la IA, si sigue viva en el mercado. */
  private pendingBuy(): Order | undefined {
    const o = this.pendingOrderId ? this.c.broker?.order(this.pendingOrderId) : undefined;
    return o && LIVE.has(o.status) ? o : undefined;
  }

  /** Pasados 25 s, la compra que no se ejecutó (o lo que falta de ella) se cancela. Devuelve si se canceló. */
  private expirePending(): boolean {
    const o = this.pendingBuy();
    if (!o || this.now - this.pendingSince <= PENDING_TIMEOUT) return false;
    this.c.cancel(o.id);
    this.log(o.filled > 0 ? `${o.sym}: se ejecutaron ${o.filled} de ${o.shares} en 25 s; se cancela el resto y se maneja lo que hay.` : `${o.sym}: la compra no se ejecutó en 25 s, se cancela.`, 'info');
    return true;
  }

  /** Un paso por segundo, con la hora del mercado. */
  step(now: number): void {
    this.now = now;
    if (this.settings.mode === 'off' || !this.source || !this.source.ready) return;
    const a = this.c.active;
    if (!a) return;
    if (a.id !== this.sessionId) {
      this.reset();
      this.sessionId = a.id;
    }
    // Posiciones abiertas (tuyas o de la IA): primero se manejan.
    const held = this.positions();
    if (held.length) {
      const sym = this.pendingSym && held.includes(this.pendingSym) ? this.pendingSym : held[0];
      this.pendingSym = sym;
      // Compra ejecutada en parte: lo que falta no se espera más de 25 s.
      this.expirePending();
      this.focusOn(sym, 'posición abierta');
      this.managePosition(sym);
      return;
    }
    if (this.state.phase === 'entering') {
      if (this.pendingBuy()) {
        if (this.expirePending()) {
          this.mem.delete(this.pendingSym);
          this.pendingSym = '';
          this.pendingOrderId = '';
          this.setPhase('watching');
        }
        return;
      }
      // La compra ya no está viva y no hay posición: se ejecutó y cerró enseguida, o la canceló el bróker.
      this.afterTrade();
      return;
    }
    if (this.state.phase === 'inPosition') {
      this.afterTrade();
      return;
    }
    const pause = this.limits();
    if (pause) {
      this.setPhase('paused', pause);
      return;
    }
    if (now < this.cooldownUntil) return this.wait('Pausa de 20 s después del último trade.');
    if (now - this.lastRank > 5000) {
      this.lastRank = now;
      this.rank();
    }
    const top = this.state.candidates[0];
    const focusStillGood = this.state.focus && this.state.candidates.slice(0, 4).some((x) => x.sym === this.state.focus);
    if (!focusStillGood) {
      if (top && top.score >= this.settings.rules.minScore) this.focusOn(top.sym, 'la mejor del escáner');
      else this.focusOn(null);
    }
    // Claude elige entre las candidatas: solo en el horario de entradas, no más seguido que cada 2 min, y
    // solo si cambiaron las 4 mejores o no hay ninguna en foco (cada consulta cuesta).
    if (this.settings.mode === 'auto' && this.settings.consult && !this.state.thinking && this.state.candidates.length >= 2 && inEntryWindow(now, this.settings.rules) && now - this.lastPick > PICK_EVERY) {
      const key = this.state.candidates
        .slice(0, 4)
        .map((x) => x.sym)
        .sort()
        .join(',');
      if ((key !== this.lastPickKey || !this.state.focus) && this.canAsk()) {
        this.lastPick = now;
        this.lastPickKey = key;
        void this.askPick();
      }
    }
    const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    if (!this.state.focus) {
      this.setPhase('scanning');
      const top = this.state.candidates[0];
      return this.wait(top ? `La mejor candidata (${top.sym}, ${top.score}) no llega al mínimo del perfil (${this.settings.rules.minScore}).` : 'Sin candidatas con volumen, noticia y float chico.');
    }
    this.setPhase('watching');
    const detail = this.detailOf(this.state.focus);
    if (!detail) return this.wait(`Esperando los datos de ${this.state.focus}…`);
    if (!inEntryWindow(now, this.settings.rules)) return this.wait(`Fuera del horario de entradas del perfil (${hhmm(this.settings.rules.entryFrom)} a ${hhmm(this.settings.rules.entryTo)} NY).`);
    const until = this.skip.get(detail.sym);
    if (until && until > now) return this.wait(`${detail.sym} se deja pasar hasta las ${formatEtTime(until, false)} (Claude dijo que no, o perdió recién).`);
    // Mientras Claude decide una entrada no se le pregunta otra; si solo está eligiendo candidata, se sigue.
    if (this.state.thinking && this.state.asking !== 'pick') return this.wait(`Consultando a Claude sobre ${detail.sym}…`);
    const quote = this.source.quote(detail.sym);
    const plan = findEntry(detail, quote, now, this.settings.rules);
    if (!plan) return this.wait(`Esperando un setup limpio en ${detail.sym} (bull flag, micro pullback de 1 min o 10 s, primera vela que hace máximo nuevo, ruptura con volumen; siempre sobre VWAP y EMA 9).`);
    const key = `${detail.sym}:${plan.kind}`;
    if (key === this.lastPlanKey && now - this.lastPlanAt < this.replan()) return this.wait(`${entryLabel(plan.kind)} en ${detail.sym}: se vuelve a considerar a las ${formatEtTime(this.lastPlanAt + this.replan(), false)}.`);
    const shares = sizeFor(this.risk(), plan.entry, plan.stop, this.c.summary().buyingPower, this.liquidity(detail));
    this.lastPlanKey = key;
    this.lastPlanAt = now;
    if (shares < 1) {
      const why = this.noBuyingPower();
      this.log(`${detail.sym}: ${entryLabel(plan.kind)} pero no se puede comprar. ${why}`, 'error');
      this.retryIn(30_000);
      return this.wait(`${detail.sym}: ${why}`);
    }
    const text = `Comprar ${shares} a $${px(plan.entry)}, stop $${px(plan.stop)} (riesgo $${((plan.entry - plan.stop) * shares).toFixed(0)}), objetivo $${px(plan.target)}. ${plan.reason}.`;
    if (this.settings.mode === 'suggest') {
      this.suggest({ kind: 'entry', sym: detail.sym, title: `${entryLabel(plan.kind)} en ${detail.sym}`, text, plan, shares });
      if (this.settings.consult && !this.state.thinking && this.canAsk()) void this.askEntry(detail, plan, shares, false);
      return this.wait('');
    }
    if (this.settings.consult && this.canAsk()) {
      this.log(`${detail.sym}: ${entryLabel(plan.kind)} a $${px(plan.entry)} (stop $${px(plan.stop)}): le pregunto a Claude.`, 'info');
      void this.askEntry(detail, plan, shares, true);
      return this.wait(`Consultando a Claude sobre ${detail.sym}…`);
    }
    // Sin Claude (no hay IA o se acabó el cupo del día): las reglas alcanzan para operar.
    this.wait('');
    this.execute(detail.sym, plan, shares, 'reglas');
  }

  private rank(): void {
    if (!this.view) return;
    const rows = [...Object.values(this.view.scanners).flat(), ...this.view.watch];
    this.state.candidates = rankCandidates(rows, this.scanSettings).slice(0, 8);
    const top = this.state.candidates[0];
    if (this.settings.mode === 'suggest' && top && top.score >= this.settings.rules.minScore + 10 && top.sym !== this.lastTop) {
      this.lastTop = top.sym;
      this.suggest({ kind: 'pick', sym: top.sym, title: `Mirá ${top.sym}`, text: `${top.reasons.join(', ')}${top.warnings.length ? ` · ojo: ${top.warnings.join(', ')}` : ''}.` });
    }
    this.emit();
  }

  private limits(): string {
    const r = this.settings.rules;
    const trades = this.c.active?.trades.length ?? 0;
    if (trades >= r.maxTrades) return `Ya hubo ${trades} trades hoy: por hoy no se abren más.`;
    const losers = this.losersInARow();
    if (losers >= r.maxLosers) return `${losers} perdedores seguidos: Ross para por hoy. Mañana se vuelve a empezar.`;
    const sum = this.c.summary();
    const loss = -sum.dayPnl;
    const max = r.maxLossR * this.risk();
    if (loss >= max) return `Pérdida del día de $${loss.toFixed(0)} (${r.maxLossR}R): no se abren más trades hoy.`;
    // El bróker rechaza el cuarto day trade con menos de US$ 25.000 en cuenta margen: mejor avisarlo antes.
    if (sum.pdt && sum.dayTrades >= 3) return 'Regla PDT: ya hay 3 day trades en 5 días con menos de US$ 25.000 en cuenta margen. Para practicar sin ese freno: en Preferencias de práctica subí el saldo a US$ 25.000 o desactivá "Regla PDT".';
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

  private async askPick(): Promise<void> {
    try {
      const d = await this.ask(pickPrompt(this.state.candidates, this.now, this.brief()), 'pick');
      if (!d) return;
      this.state.advice = { ts: this.now, sym: d.sym ?? '', decision: d.decision, text: d.reason };
      this.log(`Claude elige ${d.sym ?? 'ninguna'}: ${d.reason}`, 'ai');
      if (d.sym && this.state.candidates.some((x) => x.sym === d.sym) && d.sym !== this.state.focus) this.focusOn(d.sym, 'Claude');
    } catch (e) {
      this.log(`Claude no respondió: ${(e as Error).message}`, 'error');
    }
  }

  private async askEntry(detail: SymbolDetail, plan: EntryPlan, shares: number, execute: boolean): Promise<void> {
    const sym = detail.sym;
    try {
      const d = await this.ask(entryPrompt(detail, this.source?.quote(sym) ?? null, plan, shares, this.now, this.brief()), 'entry');
      if (!d) {
        this.log('Claude respondió algo que no se entiende.', 'error');
        return;
      }
      this.state.advice = { ts: this.now, sym, decision: d.decision, text: d.reason };
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
        const again = fresh ? findEntry(fresh, q ?? null, this.now, this.settings.rules) : null;
        let live = plan;
        if (again && again.entry <= plan.entry * 1.03) live = again;
        else if (ask <= plan.entry * 1.03 && ask > plan.stop) live = { ...plan, entry: roundPx(ask), target: roundPx(ask + this.settings.rules.targetR * (ask - plan.stop)) };
        else {
          this.log(`${sym}: se escapó mientras Claude pensaba (ask $${px(ask)}, entrada $${px(plan.entry)}): se espera el próximo descanso.`, 'info');
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
        const sized = sizeFor(this.risk(), live.entry, stop, this.c.summary().buyingPower, this.liquidity(detail));
        if (sized < 1) {
          const why = this.noBuyingPower();
          this.log(`${sym}: con el stop en $${px(stop)} no se puede comprar. ${why}`, 'error');
          this.retryIn(30_000);
          return;
        }
        this.execute(sym, { ...live, stop, target }, sized, 'Claude');
      } else if (decision === 'skip') {
        this.skip.set(sym, this.now + 10 * 60_000);
      } else {
        // "Esperar": el mismo plan se vuelve a considerar a los 3 min (no a los 60 s).
        this.lastPlanAt = this.now;
      }
    } catch (e) {
      // Sin respuesta no se entra (es lo que dice la casilla), pero el setup se vuelve a mirar enseguida.
      this.log(`Claude no respondió: ${(e as Error).message}. No se entra sin su opinión; se vuelve a mirar en 30 s.`, 'error');
      this.retryIn(30_000);
    }
  }

  private execute(sym: string, plan: EntryPlan, shares: number, by: string): void {
    // La IA opera solo comprada: con un corto abierto a mano en esa acción, una compra lo cubriría.
    if (this.c.broker?.position(sym)?.side === 'short') {
      this.log(`${sym}: tenés un corto abierto; la IA no compra (lo cubriría).`, 'info');
      return;
    }
    const q = this.source?.quote(sym);
    const ask = q?.ask ?? plan.entry;
    const price = roundPx(Math.min(ask + 0.05, plan.entry * 1.012));
    const res = this.c.place({ sym, side: 'buy', type: 'limit', price, shares, tif: 'DAY+', route: 'SMRT', stop: plan.stop, target: plan.target, setup: `IA · ${entryLabel(plan.kind)}` });
    if (!res.ok) {
      this.log(`${sym}: no se pudo comprar (${res.message}).`, 'error');
      return;
    }
    this.mem.set(sym, newMemory(this.now, price));
    this.pendingSym = sym;
    this.pendingOrderId = res.order?.id ?? '';
    this.pendingSince = this.now;
    this.setPhase('entering');
    this.log(`Compra ${shares} ${sym} a $${px(price)} (${by}): ${entryLabel(plan.kind)}, stop $${px(plan.stop)}, objetivo $${px(plan.target)}.`, 'ok');
    if (this.settings.follow) this.onSelect(sym);
  }

  private managePosition(sym: string): void {
    const pos = this.c.broker?.position(sym);
    const detail = this.detailOf(sym);
    if (!pos || pos.side === 'short' || !detail) return;
    this.setPhase('inPosition');
    let mem = this.mem.get(sym);
    if (!mem) {
      mem = newMemory(pos.openedAt, pos.avgCost);
      this.mem.set(sym, mem);
    }
    // La mitad cuenta como tomada cuando se ejecutó la venta, no cuando se mandó.
    if (pos.soldShares > 0) mem.halfTaken = true;
    const advice = manage(pos, detail, this.source!.quote(sym), this.now, mem, this.settings.rules);
    if (advice.action === 'hold') return;
    if (advice.action === this.lastExit.action && this.now - this.lastExit.at < 20_000) return;
    this.lastExit = { action: advice.action, at: this.now };
    if (this.settings.mode === 'auto') this.applyExit(sym, advice, 'reglas');
    else this.suggest({ kind: 'exit', sym, title: advice.action === 'sellHalf' ? `Vendé la mitad de ${sym}` : advice.action === 'sellAll' ? `Vendé ${sym}` : `Stop a la entrada en ${sym}`, text: `${advice.reason}.`, exit: advice });
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
      const res = this.c.sell(sym, 0.5);
      this.log(`${sym}: vende la mitad (${by}). ${advice.reason}.`, res.ok ? 'ok' : 'error');
    } else if (advice.action === 'sellAll') {
      // Las órdenes que quedaban (stop, objetivo, una venta anterior) se cancelan antes de vender todo.
      this.c.cancelAll(sym);
      const res = this.c.sell(sym, 1);
      this.log(`${sym}: vende todo (${by}). ${advice.reason}.`, res.ok ? 'ok' : 'error');
    } else if (advice.action === 'stopToBreakeven') {
      mem.breakeven = true;
      if (pos.stop) this.c.setBracket(sym, pos.avgCost, pos.target);
      this.log(`${sym}: stop a la entrada ($${px(pos.avgCost)}). ${advice.reason}.`, 'info');
    }
  }

  private afterTrade(): void {
    const sym = this.pendingSym;
    const trades = this.c.active?.trades ?? [];
    const t = sym ? trades.filter((x) => x.sym === sym).at(-1) : undefined;
    if (t && t.closedAt >= this.pendingSince) {
      this.log(`${sym} cerrado: ${t.net >= 0 ? '+' : '−'}$${Math.abs(t.net).toFixed(2)}${t.r !== undefined ? ` (${t.r.toFixed(1)}R)` : ''}.`, t.net >= 0 ? 'ok' : 'error');
      // Después de perder no se vuelve a la misma acción enseguida (revancha no es un setup).
      if (t.net < 0) this.skip.set(sym, this.now + LOSER_SKIP);
    }
    if (sym) this.mem.delete(sym);
    this.pendingSym = '';
    this.pendingOrderId = '';
    this.lastExit = { action: '', at: 0 };
    this.cooldownUntil = this.now + COOLDOWN;
    this.lastPlanAt = this.now;
    this.focusOn(null);
    this.setPhase('scanning');
  }
}

/** Re-renderiza cuando el IA Trader cambia algo. */
export function useAiVersion(t: AiTrader): number {
  const [v, setV] = useState(0);
  useEffect(() => t.subscribe(() => setV((x) => x + 1)), [t]);
  return v;
}
