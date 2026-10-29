// Día entero del simulador con el IA Trader en automático, sin navegador: qué mira, por qué espera y
// cuántos trades hace. Uso: npx tsx scripts/ia-dia.ts [semilla] [conservador|equilibrado|agresivo] [cash|margin] [saldo] [quiet]
import { LocalSource } from '../src/client/source/local';
import { DEFAULT_SETTINGS } from '../src/engine/types';
import { TrainingController } from '../src/client/training';
import { AiTrader } from '../src/client/aitrader';
import { etParts } from '../src/engine/time';
import type { TrainingStore } from '../src/trading/store';

(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
(globalThis as any).window = globalThis;
const seed = Number(process.argv[2] ?? 42);
const profile = (process.argv[3] ?? 'agresivo') as 'conservador' | 'equilibrado' | 'agresivo';
const account = (process.argv[4] ?? 'cash') as 'cash' | 'margin';
const balance = Number(process.argv[5] ?? 1000);
const quiet = process.argv[6] === 'quiet';
const dayTs = Date.parse('2026-10-23T15:00:00Z');
const src = new LocalSource(DEFAULT_SETTINGS, [], { sessionId: 's1', seed, dayTs, startMinutes: 9 * 60 + 25 });
const noop = () => {};
src.start({ onView: noop, onDetail: noop, onAlerts: noop, onNews: noop, onStatus: noop, onTick: noop } as any);
await new Promise((r) => setTimeout(r, 300));
const anySrc = src as any;
clearInterval(anySrc.timer); anySrc.timer = undefined;
const sim = anySrc.sim, engine = anySrc.engine;
const store: TrainingStore = { kind: 'navegador', load: async () => ({ state: null, sessions: [] }), saveState: async () => {}, saveSession: async () => {}, clear: async () => {} };
const c = new TrainingController(store, { state: null, sessions: [] }, 'local');
c.updateSettings({ account, latencyMs: 100 });
if (balance !== 1000) c.setBalance(balance);
c.attach(src);
const t = new AiTrader(c, () => {});
await new Promise((r) => setTimeout(r, 50));
t.attach(src);
t.update({ mode: 'auto', consult: false, profile });
const hhmm = (ts: number) => { const m = etParts(ts).minutes; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
let lastWait = '', lastPhase = '', lastLog = 0;
const waits = new Map<string, number>();
const end = sim.dayStart + (12 * 60 + 40 - 240) * 60_000;
let now = sim.now;
while (now < end) {
  sim.advance(1000); now = sim.now; engine.tick(now); c.onTick(now);
  t.setView(engine.view(), DEFAULT_SETTINGS);
  t.step(now);
  const w = t.state.waiting;
  const key = w.replace(/[A-Z]{2,5}/g, 'X').replace(/\d+[:.,]?\d*/g, 'N');
  waits.set(key, (waits.get(key) ?? 0) + 1);
  if (t.state.phase !== lastPhase || (w !== lastWait && (w.startsWith('Esperando un setup') ? !lastWait.startsWith('Esperando un setup') : true))) {
    if (!quiet) console.log(`${hhmm(now)} [${t.state.phase}] ${t.state.focus ?? '-'} ${w}`);
    lastPhase = t.state.phase; lastWait = w;
  }
  for (const l of t.state.log.slice(lastLog)) if (!quiet || /Compra|cerrado|vende/.test(l.text)) console.log(`${hhmm(l.ts)} LOG ${l.tone}: ${l.text}`);
  lastLog = t.state.log.length;
}
const trades = c.active?.trades ?? [];
const wins = trades.filter((x) => x.net > 0).length;
console.log('--- resumen ' + JSON.stringify({ seed, profile, account, balance, trades: trades.length, wins, net: trades.reduce((a, x) => a + x.net, 0).toFixed(2), avgR: (trades.reduce((a, x) => a + (x.r ?? 0), 0) / Math.max(1, trades.length)).toFixed(2), paused: t.state.pausedReason.slice(0, 60) }));
console.log('--- esperas (segundos):');
for (const [k, v] of [...waits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`${String(v).padStart(6)}  ${k.slice(0, 110)}`);
const summary = c.summary();
console.log('--- cuenta', { equity: summary.equity.toFixed(2), bp: summary.buyingPower.toFixed(2), pdt: summary.pdt, dayTrades: summary.dayTrades });
process.exit(0);
