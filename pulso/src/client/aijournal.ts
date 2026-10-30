// El informe del día del IA Trader: todo lo que hizo y por qué, para auditarlo después (o mandárselo a
// Claude para sacar lecciones). Se arma mientras opera (cada entrada con su contexto, lo que dijo Claude,
// cada paso del manejo, la salida con su resultado, las entradas que dejó pasar y por qué) y se exporta
// como Markdown (para leerlo) y JSON (para procesarlo).
import { formatEtTime } from '../engine/time';
import { fmtMoney } from './lib/format';
import type { ExitReason, Trade } from '../trading/types';
import type { PlaybookRules } from '../trading/playbook';
import type { AiLogEntry, DayMemory } from './aitrader';

export interface AiTradeContext {
  score: number;
  reasons: string[];
  warnings: string[];
  rvol: number;
  rvol5m: number;
  float?: number;
  changePct: number;
  pctFromHod: number;
  spreadPct: number;
  /** Cuánto llevaba la vela de 1 min desde su apertura al comprar (en %). */
  candlePct: number;
  preMarket: boolean;
  /** Valor de la compra sobre el capital (en %). */
  equityPct: number;
}

export interface AiClaudeNote {
  at: number;
  sym: string;
  kind: 'pick' | 'entry' | 'exit' | 'instruction' | 'summary';
  decision: string;
  confidence?: number;
  reason: string;
  stop?: number;
  target?: number;
}

export interface AiTradeRecord {
  id: number;
  sym: string;
  kind: string;
  /** Quién decidió la entrada: reglas, Claude, tu decisión. */
  by: string;
  at: number;
  entry: number;
  stop: number;
  target: number;
  shares: number;
  /** Por qué el setup era válido según las reglas. */
  reason: string;
  secondChance: boolean;
  ctx: AiTradeContext;
  claude?: AiClaudeNote;
  /** Cada paso del manejo: ventas, stop a la entrada, agregados. */
  steps: Array<{ at: number; action: string; reason: string; by: string }>;
  exit?: { at: number; avgExit: number; net: number; r?: number; reason: ExitReason; mfePct: number; maePct: number; minutes: number };
}

export interface AiMissed {
  at: number;
  sym: string;
  kind: string;
  entry: number;
  stop: number;
  why: string;
}

export interface AiJournal {
  /** Id de la sesión de práctica y día del mercado. */
  sessionId: string;
  day: string;
  profile: string;
  rules: PlaybookRules;
  mode: string;
  startedAt: number;
  log: AiLogEntry[];
  trades: AiTradeRecord[];
  missed: AiMissed[];
  claude: AiClaudeNote[];
  memory: DayMemory;
  summary: string | null;
  instructions: string[];
}

/** Tope de líneas del registro guardadas por día (un día entero a un paso por segundo no llega). */
export const JOURNAL_LOG_MAX = 3000;

export function newJournal(sessionId: string, day: string, profile: string, rules: PlaybookRules, mode: string, startedAt: number, memory: DayMemory): AiJournal {
  return { sessionId, day, profile, rules, mode, startedAt, log: [], trades: [], missed: [], claude: [], memory, summary: null, instructions: [] };
}

const px = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} %`;
const money = (v: number) => `${v >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}`;
const rr = (r?: number) => (r === undefined ? '' : ` (${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R)`);
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const fmtM = (v?: number) => (v === undefined ? 'desconocido' : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : `${Math.round(v / 1e3)} K`);
const EXIT: Record<ExitReason, string> = { manual: 'venta por regla de la IA', stop: 'stop', target: 'objetivo', eod: 'cierre del día' };

/** Nombre del archivo del informe (sin extensión). */
export function journalFilename(j: AiJournal): string {
  return `pulso-ia-informe-${j.day || 'dia'}`;
}

/** El informe en Markdown: resumen, cada trade con su historia, lo que dejó pasar, Claude, memoria y registro. */
export function journalMarkdown(j: AiJournal, trades: Trade[] = []): string {
  const out: string[] = [];
  const r = j.rules;
  out.push(`# Informe del IA Trader · ${j.day}`);
  out.push('');
  out.push(`Perfil **${j.profile}** en modo ${j.mode}. Entradas de ${hhmm(r.entryFrom)} a ${hhmm(r.entryTo)} NY, hasta ${r.maxTrades} trades, para a los ${r.maxLosers} perdedores o ${r.maxLossR}R, riesgo ×${r.riskMult}, candidatas de ${r.minScore}+, objetivo ${r.targetR}:1, ${r.maxPositions} posici${r.maxPositions === 1 ? 'ón' : 'ones'} a la vez.`);
  if (j.instructions.length) out.push(`Indicaciones del trader: ${j.instructions.join('; ')}.`);
  out.push('');
  const done = j.trades.filter((t) => t.exit);
  const net = done.reduce((v, t) => v + (t.exit?.net ?? 0), 0);
  const netR = done.reduce((v, t) => v + (t.exit?.r ?? 0), 0);
  const wins = done.filter((t) => (t.exit?.net ?? 0) > 0).length;
  out.push('## Resumen');
  out.push('');
  out.push(`- Trades de la IA: ${j.trades.length} (${done.length} cerrados, ${wins} ganadores, ${done.length - wins} perdedores).`);
  out.push(`- Resultado neto: ${money(net)}${done.length ? ` (${netR >= 0 ? '+' : '−'}${Math.abs(netR).toFixed(1)}R)` : ''}.`);
  out.push(`- Entradas que dejó pasar: ${j.missed.length}. Consultas a Claude: ${j.claude.length}.`);
  const other = trades.filter((t) => !j.trades.some((x) => x.sym === t.sym && Math.abs(x.at - t.openedAt) < 60_000));
  if (other.length) out.push(`- Otros trades del día (tuyos, no de la IA): ${other.length}, ${money(other.reduce((v, t) => v + t.net, 0))}.`);
  out.push('');
  out.push('## Trades de la IA');
  out.push('');
  if (!j.trades.length) out.push('_No hubo trades de la IA._');
  j.trades.forEach((t, i) => {
    const c = t.ctx;
    out.push(`### ${i + 1}. ${t.sym} · ${t.kind} · ${formatEtTime(t.at, false)} NY${t.exit ? ` · ${money(t.exit.net)}${rr(t.exit.r)}` : ' · abierto'}`);
    out.push('');
    out.push(`- **Entrada**: ${t.shares} acciones a $${px(t.entry)}, stop $${px(t.stop)} (${(((t.entry - t.stop) / t.entry) * 100).toFixed(1)} %, riesgo ${fmtMoney((t.entry - t.stop) * t.shares)}), objetivo $${px(t.target)} (${((t.target - t.entry) / Math.max(1e-9, t.entry - t.stop)).toFixed(1)}R). Decidió: ${t.by}.${t.secondChance ? ' Segunda chance después de un stop.' : ''}`);
    out.push(`- **Setup**: ${t.reason}.`);
    out.push(`- **Contexto**: puntaje ${c.score} (${c.reasons.join(', ') || 'sin motivos'}${c.warnings.length ? `; ojo: ${c.warnings.join(', ')}` : ''}), ${pct(c.changePct)} en el día, ${c.pctFromHod.toFixed(1)} % del máximo, RVOL ${c.rvol.toFixed(0)}x (5 min ${c.rvol5m.toFixed(0)}x), float ${fmtM(c.float)}, spread ${c.spreadPct.toFixed(1)} %, la vela de 1 min llevaba ${pct(c.candlePct)} desde su apertura, ${c.equityPct.toFixed(0)} % del capital${c.preMarket ? ', en pre-market' : ''}.`);
    if (t.claude) out.push(`- **Claude**: ${t.claude.decision}${t.claude.confidence !== undefined ? ` (${t.claude.confidence} %)` : ''}: ${t.claude.reason}${t.claude.stop ? ` Stop sugerido $${px(t.claude.stop)}.` : ''}${t.claude.target ? ` Objetivo sugerido $${px(t.claude.target)}.` : ''}`);
    if (t.steps.length) {
      out.push('- **Manejo**:');
      for (const s of t.steps) out.push(`  - ${formatEtTime(s.at, true)} ${s.action}: ${s.reason} (${s.by}).`);
    }
    if (t.exit) out.push(`- **Salida**: ${formatEtTime(t.exit.at, true)} a $${px(t.exit.avgExit)} por ${EXIT[t.exit.reason]}, ${t.exit.minutes.toFixed(1)} min en el trade, MFE ${pct(t.exit.mfePct)}, MAE ${pct(t.exit.maePct)}. Resultado ${money(t.exit.net)}${rr(t.exit.r)}.`);
    out.push('');
  });
  out.push('## Entradas que dejó pasar');
  out.push('');
  if (!j.missed.length) out.push('_Ninguna anotada._');
  for (const m of j.missed) out.push(`- ${formatEtTime(m.at, false)} ${m.sym} · ${m.kind} a $${px(m.entry)} (stop $${px(m.stop)}): ${m.why}`);
  out.push('');
  out.push('## Consultas a Claude');
  out.push('');
  if (!j.claude.length) out.push('_No hubo consultas._');
  for (const c of j.claude) out.push(`- ${formatEtTime(c.at, false)} ${c.sym || '—'} (${c.kind}): ${c.decision}${c.confidence !== undefined ? ` ${c.confidence} %` : ''}. ${c.reason}`);
  out.push('');
  out.push('## Memoria del día');
  out.push('');
  const syms = Object.entries(j.memory.syms);
  if (!syms.length) out.push('_Sin anotaciones por acción._');
  for (const [sym, d] of syms) out.push(`- ${sym}: ${d.trades} trade${d.trades === 1 ? '' : 's'}, ${d.wins} ganador${d.wins === 1 ? '' : 'es'}, ${d.losers} perdedor${d.losers === 1 ? '' : 'es'}, ${d.netR >= 0 ? '+' : '−'}${Math.abs(d.netR).toFixed(1)}R, ${d.brakes} freno${d.brakes === 1 ? '' : 's'}, ${d.reentries} reentrada${d.reentries === 1 ? '' : 's'}.`);
  for (const [k, v] of Object.entries(j.memory.setups)) out.push(`- Setup ${k}: ${v.trades} trade${v.trades === 1 ? '' : 's'}, ${v.wins} ganador${v.wins === 1 ? '' : 'es'}, ${v.losers} perdedor${v.losers === 1 ? '' : 'es'}, ${v.netR >= 0 ? '+' : '−'}${Math.abs(v.netR).toFixed(1)}R.`);
  out.push('');
  out.push('## Resumen de Claude');
  out.push('');
  out.push(j.summary ?? '_Todavía no hay resumen (Claude lo escribe al terminar el día)._');
  out.push('');
  out.push('## Registro completo');
  out.push('');
  for (const l of j.log) out.push(`- ${formatEtTime(l.ts, true)} [${l.tone}] ${l.text}`);
  out.push('');
  return out.join('\n');
}
