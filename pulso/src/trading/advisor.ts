// Lo que se le cuenta a Claude para que opine como entrenador de momentum (estilo Ross Cameron) y cómo
// se lee su respuesta. Funciones puras: el pedido en sí lo hace la página (artifact) o el servidor.
import { formatEtTime } from '../engine/time';
import type { Quote, SymbolDetail } from '../engine/types';
import type { Candidate, EntryPlan, PositionMemory } from './playbook';
import { entryLabel } from './playbook';
import type { Position, Trade } from './types';

export const ADVISOR_SYSTEM =
  'Sos un day trader profesional de momentum en small caps de EE.UU. que opera y enseña con el método de Ross Cameron ' +
  '(Warrior Trading): los 5 pilares (precio entre $1 y $20, suba del día de 10 % o más, volumen relativo 5x o más, noticia ' +
  'como catalizador, float chico), operar "la obvia" del día, entradas en bull flag, micro pullback y rupturas del máximo ' +
  'con el precio sobre VWAP y EMA 9, stop ajustado debajo del retroceso, objetivo 2:1 o más, vender la mitad en el objetivo ' +
  'y subir el stop a la entrada, cortar rápido lo que no avanza, no perseguir extensiones ni acciones con riesgo de ' +
  'dilución, y respetar la pérdida máxima del día. Respondés solo con JSON válido, sin texto alrededor, en español ' +
  'rioplatense (voseo) en el campo "reason", corto y concreto (una o dos frases con números).';

export interface AccountBrief {
  equity: number;
  riskPerTrade: number;
  dayPnl: number;
  tradesToday: number;
  losersInARow: number;
}

/** Los mejores niveles del libro (Level 2), ya sumados por precio: hasta 3 por lado. */
export interface BookBrief {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

const px = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const k = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

function rowLine(c: Candidate): string {
  const r = c.row;
  return (
    `${r.sym}: $${px(r.price)} ${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(0)} % hoy, RVOL ${r.rvol.toFixed(0)}x, ` +
    `float ${r.float !== undefined ? k(r.float) : '?'}, ${r.hasNews ? 'con noticia' : 'sin noticia'}, ${r.pillars.score} pilares, ` +
    `${Math.abs(r.pctFromHod).toFixed(1)} % bajo el máximo, 5 min ${r.chg5m >= 0 ? '+' : ''}${r.chg5m.toFixed(1)} %, vol 5 min ${k(r.vol5m)}` +
    (c.warnings.length ? ` · ojo: ${c.warnings.join(', ')}` : '')
  );
}

function detailBrief(d: SymbolDetail, q: Quote | null, book?: BookBrief | null): string {
  const bars = d.bars.slice(-15).map((b) => `${formatEtTime(b.t, false)} o${px(b.o)} h${px(b.h)} l${px(b.l)} c${px(b.c)} v${k(b.v)}`);
  const secs = d.secBars.slice(-12).map((b) => `o${px(b.o)} h${px(b.h)} l${px(b.l)} c${px(b.c)} v${k(b.v)}`);
  const lvl = (l: { price: number; size: number }) => `${px(l.price)}×${k(l.size)}`;
  const tape = d.tape.slice(-30);
  const atAsk = tape.filter((t) => t.side === 'ask').length;
  const atBid = tape.filter((t) => t.side === 'bid').length;
  const news = d.news.slice(0, 2).map((n) => `"${n.headline}"`).join(' · ');
  return [
    `${d.sym} (${d.ref.name ?? ''}${d.ref.industry ? `, ${d.ref.industry}` : ''}): último $${px(d.row.price)}, bid ${px(q?.bid ?? d.row.bid)} x ${q?.bidSize ?? 0}, ask ${px(q?.ask ?? d.row.ask)} x ${q?.askSize ?? 0}.`,
    `Máximo del día ${px(d.row.hod)}, mínimo ${px(d.lod)}, máximo pre-market ${px(d.pmHigh)}, VWAP ${px(d.row.vwap)}, EMA 9 ${px(d.ema9)}, EMA 20 ${px(d.ema20)}, próximo nivel redondo ${px(d.setup.nextLevel)}.`,
    `Sobre VWAP: ${d.setup.aboveVwap ? 'sí' : 'no'}; sobre EMA 9: ${d.setup.aboveEma9 ? 'sí' : 'no'}; MACD alcista: ${d.setup.macdBullish ? 'sí' : 'no'}${d.setup.flag ? `; bull flag armado (entrada ${px(d.setup.flag.entry)}, stop ${px(d.setup.flag.stop)})` : ''}.`,
    `Cinta (últimos ${tape.length} prints): ${atAsk} al ask, ${atBid} al bid.`,
    news ? `Noticias: ${news}.` : 'Sin noticias recientes.',
    `Velas de 1 min (las últimas ${bars.length}): ${bars.join(' | ')}`,
    secs.length ? `Velas de 10 s (las últimas ${secs.length}, de la más vieja a la más nueva): ${secs.join(' | ')}` : '',
    book && (book.bids.length || book.asks.length) ? `Libro: bids ${book.bids.slice(0, 3).map(lvl).join(', ') || '-'} · asks ${book.asks.slice(0, 3).map(lvl).join(', ') || '-'}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function accountLine(a: AccountBrief): string {
  return `Cuenta de práctica: $${a.equity.toFixed(0)}, riesgo por trade $${a.riskPerTrade.toFixed(0)}, hoy ${a.dayPnl >= 0 ? '+' : ''}$${a.dayPnl.toFixed(0)}, ${a.tradesToday} trades, ${a.losersInARow} perdedores seguidos.`;
}

/** ¿Cuál de las candidatas mirar? */
export function pickPrompt(cands: Candidate[], now: number, acct: AccountBrief): string {
  return (
    `Son las ${formatEtTime(now, false)} hora de Nueva York. ${accountLine(acct)}\n` +
    `Candidatas del escáner, de mejor a peor según las reglas:\n${cands.slice(0, 6).map(rowLine).join('\n')}\n\n` +
    'Elegí una sola para mirar de cerca (la "obvia": volumen relativo, float, noticia, cerca del máximo) o ninguna si ' +
    'no vale la pena. JSON: {"sym": "XXXX" | null, "reason": "..."}'
  );
}

/** ¿Entro con este plan? */
export function entryPrompt(d: SymbolDetail, q: Quote | null, plan: EntryPlan, shares: number, now: number, acct: AccountBrief, book?: BookBrief | null): string {
  const risk = plan.entry - plan.stop;
  const rr = risk > 0 ? ((plan.target - plan.entry) / risk).toFixed(1) : '?';
  return (
    `Son las ${formatEtTime(now, false)} hora de Nueva York. ${accountLine(acct)}\n${detailBrief(d, q, book)}\n\n` +
    `Las reglas proponen: ${entryLabel(plan.kind)}. Comprar ${shares} acciones a $${px(plan.entry)}, stop $${px(plan.stop)} ` +
    `(riesgo $${(risk * shares).toFixed(0)}), objetivo $${px(plan.target)} (${rr}R). Motivo: ${plan.reason}.\n` +
    'Las reglas ya validaron el setup (sobre VWAP y EMA 9, stop cerca, objetivo que paga): tu trabajo es vetarlo solo si ves un ' +
    'motivo concreto (spread mayor al 2 %, extensión enorme sin descanso, cinta vendiendo al bid, riesgo de dilución, halt reciente, ' +
    'horario malo). Si no hay un motivo concreto, "enter". "wait" solo con un motivo y qué esperar; "skip" si la acción no vale la pena hoy. ' +
    'JSON: {"decision": "enter" | "wait" | "skip", "confidence": 0-100, "reason": "...", "stop": número opcional si lo ajustarías, "target": número opcional}'
  );
}

/** ¿Qué hago con la posición? */
export function exitPrompt(d: SymbolDetail, q: Quote | null, pos: Position, mem: PositionMemory, now: number, acct: AccountBrief): string {
  const risk = pos.initialStop ? pos.avgCost - pos.initialStop : pos.avgCost * 0.03;
  const last = q?.last || d.row.price;
  const r = risk > 0 ? (last - pos.avgCost) / risk : 0;
  return (
    `Son las ${formatEtTime(now, false)} hora de Nueva York. ${accountLine(acct)}\n${detailBrief(d, q)}\n\n` +
    `Posición: ${pos.shares} acciones a $${px(pos.avgCost)} desde hace ${Math.round((now - mem.enteredAt) / 60_000)} min, stop ${pos.stop ?? pos.planStop ?? pos.initialStop ?? '-'}, ` +
    `objetivo ${pos.target ?? pos.planTarget ?? '-'}, va ${r >= 0 ? '+' : ''}${r.toFixed(1)}R${mem.halfTaken ? ', la mitad ya vendida' : ''}${mem.breakeven ? ', stop en la entrada' : ''}.\n` +
    '¿Qué hacés? JSON: {"decision": "hold" | "sellHalf" | "sellAll" | "stopToBreakeven", "reason": "..."}'
  );
}

/** Lo que hizo la IA hoy, para que Claude lo resuma en 4 o 5 frases. */
export interface DayBrief {
  profile: string;
  trades: Trade[];
  /** Las líneas del registro de hoy (lo que miró, por qué esperó, qué frenó). */
  log: string[];
}

const money = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(0)}`;

/** Resumen del día: qué operó, qué funcionó, qué no y una sugerencia. */
export function dayPrompt(d: DayBrief, now: number, acct: AccountBrief): string {
  const trades = d.trades.map((t) => `${formatEtTime(t.openedAt, false)}-${formatEtTime(t.closedAt, false)} ${t.sym} ${t.shares} acc. $${px(t.avgEntry)} → $${px(t.avgExit)}: ${money(t.net)}${t.r !== undefined ? ` (${t.r.toFixed(1)}R)` : ''}, salida ${t.exitReason}${t.setup ? `, ${t.setup}` : ''}`);
  return (
    `Son las ${formatEtTime(now, false)} hora de Nueva York y terminó el día del IA Trader (perfil ${d.profile}). ${accountLine(acct)}\n` +
    `Trades de hoy (${trades.length}):\n${trades.join('\n') || '(ninguno)'}\n\n` +
    `Registro del día (lo último):\n${d.log.slice(-40).join('\n')}\n\n` +
    'Resumí el día en 4 o 5 frases: qué operó la IA, qué funcionó, qué no, y una sugerencia concreta para mañana. ' +
    'JSON: {"summary": "..."}'
  );
}

/** Lee el resumen del día de la respuesta (o null si no se entiende). */
export function parseSummary(text: string): string | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return text.trim() ? text.trim().slice(0, 900) : null;
  try {
    const d = JSON.parse(m[0]) as { summary?: unknown; reason?: unknown };
    const out = typeof d.summary === 'string' ? d.summary : typeof d.reason === 'string' ? d.reason : '';
    return out.trim() ? out.trim().slice(0, 900) : null;
  } catch {
    return null;
  }
}

export interface Decision {
  decision: string;
  confidence?: number;
  reason: string;
  sym?: string | null;
  stop?: number;
  target?: number;
}

/** Lee el JSON de la respuesta aunque venga con texto alrededor. */
export function parseDecision(text: string): Decision | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]) as Partial<Decision>;
    if (!d || typeof d !== 'object') return null;
    return {
      decision: String(d.decision ?? (d.sym ? 'pick' : '')),
      confidence: typeof d.confidence === 'number' ? Math.max(0, Math.min(100, d.confidence)) : undefined,
      reason: String(d.reason ?? '').slice(0, 400),
      sym: d.sym === null ? null : typeof d.sym === 'string' ? d.sym.toUpperCase() : undefined,
      stop: typeof d.stop === 'number' && d.stop > 0 ? d.stop : undefined,
      target: typeof d.target === 'number' && d.target > 0 ? d.target : undefined,
    };
  } catch {
    return null;
  }
}
