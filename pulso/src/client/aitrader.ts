// El IA Trader: mira los escáneres como un trader de momentum, elige "la obvia", la sigue de cerca
// (velas, VWAP, EMA 9, cinta), entra con stop y objetivo 2:1, maneja la posición y sale. En modo
// "sugerencias" te propone cada paso y vos decidís; en "automático" opera solo la cuenta de práctica.
// Claude, si está disponible, opina antes de cada entrada (y elige entre las candidatas).
import { DEFAULT_SETTINGS, type Settings, type SymbolDetail, type ViewModel } from '../engine/types';
import { ADVISOR_SYSTEM, entryPrompt, exitPrompt, parseDecision, pickPrompt, type AccountBrief } from '../trading/advisor';
import { roundPx } from '../trading/depth';
import { DEFAULT_RULES, entryLabel, findEntry, inEntryWindow, manage, newMemory, rankCandidates, sizeFor, type Candidate, type EntryPlan, type ExitAdvice, type PlaybookRules, type PositionMemory } from '../trading/playbook';
import { aiAvailable, type Asker } from './lib/ai';
import { load, save } from './lib/storage';
import type { DataSource } from './source/types';
import type { TrainingController } from './training';
import { useEffect, useState } from 'react';

export type AiMode = 'off' | 'suggest' | 'auto';

export interface AiSettings {
  mode: AiMode;
  /** Consultar a Claude antes de cada entrada (y para elegir entre las candidatas). */
  consult: boolean;
  /** Mostrar en el gráfico la acción que mira la IA. */
  follow: boolean;
  rules: PlaybookRules;
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
  calls: number;
  pausedReason: string;
  /** Qué IA hay: la de Claude (artifact), la del servidor (clave de Anthropic), ninguna o todavía no se sabe. */
  ai: 'claude' | 'servidor' | 'no' | '?';
  thinking: boolean;
}

const DEFAULT_AI: AiSettings = { mode: 'off', consult: true, follow: true, rules: DEFAULT_RULES };
const px = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const ASK_TIMEOUT = 15_000;

export class AiTrader {
  settings: AiSettings;
  state: AiState = { phase: 'off', focus: null, since: 0, candidates: [], suggestion: null, advice: null, log: [], calls: 0, pausedReason: '', ai: '?', thinking: false };
  private listeners = new Set<() => void>();
  private source: DataSource | null = null;
  private view: ViewModel | null = null;
  private scanSettings: Settings = DEFAULT_SETTINGS;
  private asker: Asker | null = null;
  private seq = 0;
  private lastRank = 0;
  private lastPick = 0;
  private lastTop = '';
  private mem = new Map<string, PositionMemory>();
  private skip = new Map<string, number>();
  private lastPlanKey = '';
  private lastPlanAt = 0;
  private pendingSym = '';
  private pendingSince = 0;
  private cooldownUntil = 0;
  private lastExit = { action: '', at: 0 };
  private lastSuggestKey = '';
  private dayKey = '';
  private now = 0;

  constructor(
    private readonly c: TrainingController,
    private readonly onSelect: (sym: string) => void,
  ) {
    const saved = load<Partial<AiSettings>>('ai-settings', {});
    this.settings = { ...DEFAULT_AI, ...saved, rules: { ...DEFAULT_RULES, ...(saved.rules ?? {}) } };
    this.state.phase = this.settings.mode === 'off' ? 'off' : 'scanning';
    void aiAvailable().then((ai) => {
      this.asker = ai?.ask ?? null;
      this.state.ai = ai ? ai.via : 'no';
      this.emit();
    });
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
    this.settings = { ...this.settings, ...patch, rules: { ...this.settings.rules, ...(patch.rules ?? {}) } };
    save('ai-settings', this.settings);
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
    return { equity: sum.equity, riskPerTrade: this.c.riskAmount(), dayPnl: sum.dayPnl, tradesToday: this.c.active?.trades.length ?? 0, losersInARow: this.losersInARow() };
  }

  private losersInARow(): number {
    const trades = this.c.active?.trades ?? [];
    let n = 0;
    for (let i = trades.length - 1; i >= 0 && trades[i].net < 0; i--) n++;
    return n;
  }

  private async ask(prompt: string): Promise<ReturnType<typeof parseDecision>> {
    if (!this.asker) return null;
    this.state.thinking = true;
    this.state.calls++;
    this.emit();
    try {
      const text = await Promise.race([this.asker(ADVISOR_SYSTEM, prompt), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('Claude tardó más de 15 s')), ASK_TIMEOUT))]);
      return parseDecision(text);
    } finally {
      this.state.thinking = false;
      this.emit();
    }
  }

  /** Preguntarle a Claude ahora mismo por lo que está mirando (o por la posición abierta). */
  async askNow(): Promise<void> {
    if (!this.asker || !this.source) return;
    const now = this.now || Date.now();
    const syms = this.c.broker?.symbols() ?? [];
    try {
      if (syms.length) {
        const sym = syms[0];
        const pos = this.c.broker!.position(sym)!;
        const detail = this.detailOf(sym);
        if (!detail) return;
        const d = await this.ask(exitPrompt(detail, this.source.quote(sym), pos, this.mem.get(sym) ?? newMemory(pos.openedAt, pos.avgCost), now, this.brief()));
        if (d) this.state.advice = { ts: now, sym, decision: d.decision, text: d.reason };
      } else if (this.state.focus) {
        const detail = this.detailOf(this.state.focus);
        if (!detail) return;
        const plan = findEntry(detail, this.source.quote(detail.sym), now);
        const shares = plan ? sizeFor(this.c.riskAmount(), plan.entry, plan.stop, this.c.summary().buyingPower, this.liquidity(detail)) : 0;
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

  /** Un paso por segundo, con la hora del mercado. */
  step(now: number): void {
    this.now = now;
    if (this.settings.mode === 'off' || !this.source || !this.source.ready) return;
    const a = this.c.active;
    if (!a) return;
    if (a.dayKey !== this.dayKey) {
      this.dayKey = a.dayKey;
      this.mem.clear();
      this.skip.clear();
      this.cooldownUntil = 0;
    }
    // Posiciones abiertas (tuyas o de la IA): primero se manejan.
    const syms = this.c.broker?.symbols() ?? [];
    if (syms.length) {
      const sym = this.pendingSym && syms.includes(this.pendingSym) ? this.pendingSym : syms[0];
      this.pendingSym = sym;
      this.focusOn(sym, 'posición abierta');
      this.managePosition(sym);
      return;
    }
    if (this.state.phase === 'entering') {
      const open = this.c.broker?.orders(this.pendingSym).some((o) => o.status === 'open' || o.status === 'sent' || o.status === 'partial');
      if (open) {
        if (now - this.pendingSince > 25_000) {
          this.c.cancelAll(this.pendingSym);
          this.log(`${this.pendingSym}: la compra no se ejecutó en 25 s, se cancela.`, 'info');
          this.pendingSym = '';
          this.setPhase('watching');
        }
        return;
      }
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
    if (now < this.cooldownUntil) return;
    if (now - this.lastRank > 5000) {
      this.lastRank = now;
      this.rank();
    }
    const top = this.state.candidates[0];
    const focusStillGood = this.state.focus && this.state.candidates.slice(0, 4).some((x) => x.sym === this.state.focus);
    if (!focusStillGood) {
      if (top && top.score >= 45) this.focusOn(top.sym, 'la mejor del escáner');
      else this.focusOn(null);
    }
    if (this.settings.mode === 'auto' && this.settings.consult && this.asker && !this.state.thinking && this.state.candidates.length >= 2 && now - this.lastPick > 120_000) {
      this.lastPick = now;
      void this.askPick();
    }
    if (!this.state.focus) {
      this.setPhase('scanning');
      return;
    }
    this.setPhase('watching');
    const detail = this.detailOf(this.state.focus);
    if (!detail) return;
    if (!inEntryWindow(now, this.settings.rules)) return;
    const until = this.skip.get(detail.sym);
    if (until && until > now) return;
    const quote = this.source.quote(detail.sym);
    const plan = findEntry(detail, quote, now);
    if (!plan) return;
    const key = `${detail.sym}:${plan.kind}`;
    if (key === this.lastPlanKey && now - this.lastPlanAt < 180_000) return;
    const shares = sizeFor(this.c.riskAmount(), plan.entry, plan.stop, this.c.summary().buyingPower, this.liquidity(detail));
    this.lastPlanKey = key;
    this.lastPlanAt = now;
    if (shares < 1) {
      this.log(`${detail.sym}: ${entryLabel(plan.kind)} pero no alcanza el poder de compra o la liquidez para el tamaño por riesgo.`, 'info');
      return;
    }
    const text = `Comprar ${shares} a $${px(plan.entry)}, stop $${px(plan.stop)} (riesgo $${((plan.entry - plan.stop) * shares).toFixed(0)}), objetivo $${px(plan.target)}. ${plan.reason}.`;
    if (this.settings.mode === 'suggest') {
      this.suggest({ kind: 'entry', sym: detail.sym, title: `${entryLabel(plan.kind)} en ${detail.sym}`, text, plan, shares });
      if (this.settings.consult && this.asker && !this.state.thinking) void this.askEntry(detail, plan, shares, false);
      return;
    }
    if (this.settings.consult && this.asker) {
      if (!this.state.thinking) void this.askEntry(detail, plan, shares, true);
      return;
    }
    this.execute(detail.sym, plan, shares, 'reglas');
  }

  private rank(): void {
    if (!this.view) return;
    const rows = [...Object.values(this.view.scanners).flat(), ...this.view.watch];
    this.state.candidates = rankCandidates(rows, this.scanSettings).slice(0, 8);
    const top = this.state.candidates[0];
    if (this.settings.mode === 'suggest' && top && top.score >= 55 && top.sym !== this.lastTop) {
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
    const loss = -this.c.summary().dayPnl;
    const max = r.maxLossR * this.c.riskAmount();
    if (loss >= max) return `Pérdida del día de $${loss.toFixed(0)} (${r.maxLossR}R): no se abren más trades hoy.`;
    return '';
  }

  private async askPick(): Promise<void> {
    try {
      const d = await this.ask(pickPrompt(this.state.candidates, this.now, this.brief()));
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
      const d = await this.ask(entryPrompt(detail, this.source?.quote(sym) ?? null, plan, shares, this.now, this.brief()));
      if (!d) {
        this.log('Claude respondió algo que no se entiende.', 'error');
        return;
      }
      this.state.advice = { ts: this.now, sym, decision: d.decision, text: d.reason };
      const verdict = d.decision === 'enter' ? 'entra' : d.decision === 'wait' ? 'espera' : 'no entra';
      this.log(`Claude ${verdict}${d.confidence !== undefined ? ` (${d.confidence} %)` : ''}: ${d.reason}`, 'ai');
      if (!execute) return;
      if (d.decision === 'enter') {
        // El plan tiene que seguir vigente: el precio no se fue ni cayó debajo del stop.
        const q = this.source?.quote(sym);
        const ask = q?.ask ?? plan.entry;
        if (ask > plan.entry * 1.015 || ask <= plan.stop) {
          this.log(`${sym}: el precio se movió mientras Claude pensaba (${px(ask)}); se deja pasar.`, 'info');
          return;
        }
        const stop = d.stop && d.stop < plan.entry && d.stop > plan.entry * 0.93 ? d.stop : plan.stop;
        const target = d.target && d.target > plan.entry ? d.target : plan.target;
        this.execute(sym, { ...plan, stop, target }, shares, 'Claude');
      } else if (d.decision === 'skip') {
        this.skip.set(sym, this.now + 10 * 60_000);
      } else {
        this.lastPlanAt = this.now - 120_000;
      }
    } catch (e) {
      this.log(`Claude no respondió: ${(e as Error).message}. No se entra sin su opinión.`, 'error');
    }
  }

  private execute(sym: string, plan: EntryPlan, shares: number, by: string): void {
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
    this.pendingSince = this.now;
    this.setPhase('entering');
    this.log(`Compra ${shares} ${sym} a $${px(price)} (${by}): ${entryLabel(plan.kind)}, stop $${px(plan.stop)}, objetivo $${px(plan.target)}.`, 'ok');
    if (this.settings.follow) this.onSelect(sym);
  }

  private managePosition(sym: string): void {
    const pos = this.c.broker?.position(sym);
    const detail = this.detailOf(sym);
    if (!pos || !detail) return;
    this.setPhase('inPosition');
    let mem = this.mem.get(sym);
    if (!mem) {
      mem = newMemory(pos.openedAt, pos.avgCost);
      this.mem.set(sym, mem);
    }
    if (pos.soldShares > 0) mem.halfTaken = true;
    const advice = manage(pos, detail, this.source!.quote(sym), this.now, mem);
    if (advice.action === 'hold') return;
    if (advice.action === this.lastExit.action && this.now - this.lastExit.at < 20_000) return;
    this.lastExit = { action: advice.action, at: this.now };
    if (this.settings.mode === 'auto') this.applyExit(sym, advice, 'reglas');
    else this.suggest({ kind: 'exit', sym, title: advice.action === 'sellHalf' ? `Vendé la mitad de ${sym}` : advice.action === 'sellAll' ? `Vendé ${sym}` : `Stop a la entrada en ${sym}`, text: `${advice.reason}.`, exit: advice });
  }

  private applyExit(sym: string, advice: ExitAdvice, by: string): void {
    const pos = this.c.broker?.position(sym);
    if (!pos) return;
    const mem = this.mem.get(sym) ?? newMemory(pos.openedAt, pos.avgCost);
    this.mem.set(sym, mem);
    if (advice.action === 'sellHalf') {
      const res = this.c.sell(sym, 0.5);
      if (res.ok) mem.halfTaken = true;
      this.log(`${sym}: vende la mitad (${by}). ${advice.reason}.`, res.ok ? 'ok' : 'error');
    } else if (advice.action === 'sellAll') {
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
    }
    if (sym) this.mem.delete(sym);
    this.pendingSym = '';
    this.cooldownUntil = this.now + 20_000;
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
