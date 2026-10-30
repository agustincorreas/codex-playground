// Backtest del IA Trader con un clic: simula los últimos N días hábiles (el mercado de "Mercado ahora"
// de cada fecha) con el perfil elegido en el IA Trader y una cuenta de práctica nueva por día, y muestra
// cómo le fue: trades, aciertos, R, neto, mejor y peor día, racha de pérdidas y la curva de capital.
// Corre en un Worker; en la página única del demo (sin archivo aparte para el Worker) corre en el hilo
// principal en tandas cortas para no congelar la interfaz.
import { useEffect, useRef, useState } from 'react';
import { useAiVersion, type AiTrader } from '../aitrader';
import { PROFILE_LABEL } from '../../trading/playbook';
import { DEFAULT_START, recentDays, runBacktest, summarizeBacktest, type BacktestDay, type BacktestDayResult, type BacktestMessage, type BacktestRequest, type BacktestSetup, type BacktestSummary } from '../lib/backtest';
import { fmtDay, fmtMinutes } from '../lib/days';
import { fmtMoney, fmtSignedMoney } from '../lib/format';
import { load, save } from '../lib/storage';

const DAY_CHOICES = [5, 10, 20] as const;
/** Página única del demo: el JS va dentro del HTML y no hay archivo aparte para el Worker. */
const INLINE = import.meta.env.MODE === 'demo' || typeof Worker === 'undefined';
/** En el hilo principal: trabajo seguido antes de ceder el hilo (la interfaz sigue respondiendo). */
const SLICE_MS = 40;

interface Running {
  days: BacktestDay[];
  day: number;
  fraction: number;
  results: BacktestDayResult[];
  inline: boolean;
}

interface Finished {
  days: BacktestDay[];
  results: BacktestDayResult[];
  summary: BacktestSummary;
  balance: number;
  profile: string;
  account: 'cash' | 'margin';
}

export function Backtest({ trader }: { trader: AiTrader }) {
  useAiVersion(trader);
  const [balance, setBalance] = useState(() => load<number>('backtest-balance', 30_000));
  const [account, setAccount] = useState<'cash' | 'margin'>(() => load<'cash' | 'margin'>('backtest-account', 'margin'));
  const [running, setRunning] = useState<Running | null>(null);
  const [done, setDone] = useState<Finished | null>(null);
  const [error, setError] = useState('');
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const profile = trader.settings.profile;
  const profileLabel = PROFILE_LABEL[profile];
  const okBalance = Number.isFinite(balance) && balance >= 100;

  const cancel = () => {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(null);
  };

  const start = (n: number) => {
    cancel();
    const days = recentDays(n);
    const setup: BacktestSetup = { profile, rules: trader.settings.rules, account, balance, consult: false };
    const results: BacktestDayResult[] = [];
    let over = false;
    setError('');
    setDone(null);
    const show = (day: number, fraction: number, inline: boolean) => setRunning({ days, day, fraction, results: results.slice(), inline });
    const finish = (fn: () => void) => {
      over = true;
      stopRef.current = null;
      setRunning(null);
      fn();
    };
    const handle = (m: BacktestMessage, inline: boolean) => {
      if (over) return;
      if (m.type === 'progress') show(m.day, m.fraction, inline);
      else if (m.type === 'day') {
        results.push(m.result);
        show(m.day, 1, inline);
      } else if (m.type === 'done') finish(() => setDone({ days, results, summary: summarizeBacktest(results, balance), balance, profile: profileLabel, account }));
      else finish(() => setError(m.message));
    };
    const runInline = () => {
      const ctl = new AbortController();
      stopRef.current = () => {
        over = true;
        ctl.abort();
      };
      show(0, 0, true);
      void runBacktest(days, setup, (m) => handle(m, true), { sliceMs: SLICE_MS, signal: ctl.signal });
    };
    if (INLINE) return runInline();
    let worker: Worker;
    try {
      worker = new Worker(new URL('../lib/backtest.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return runInline();
    }
    let heard = false;
    worker.onmessage = (e: MessageEvent<BacktestMessage>) => {
      heard = true;
      handle(e.data, false);
      if (e.data.type === 'done' || e.data.type === 'error') worker.terminate();
    };
    worker.onerror = (e) => {
      worker.terminate();
      // El archivo del Worker no cargó (por ejemplo, la página se sirvió sin sus assets): en el hilo principal.
      if (!heard) runInline();
      else finish(() => setError(e.message || 'El backtest falló.'));
    };
    stopRef.current = () => {
      over = true;
      worker.terminate();
    };
    show(0, 0, false);
    const req: BacktestRequest = { type: 'run', days, setup };
    worker.postMessage(req);
  };

  return (
    <div className="ai-panel bt-panel">
      <p className="t-muted small ai-note">
        Simula los últimos días hábiles (el mismo mercado que tuvo <em>Mercado ahora</em> cada fecha) con el perfil <b>{profileLabel}</b> del IA Trader, solo con las reglas (sin Claude), desde las{' '}
        {fmtMinutes(DEFAULT_START)}. Cada día arranca con el saldo elegido en una cuenta de práctica aparte: la tuya no se toca.
      </p>
      <div className="ai-row">
        <label className="bt-field">
          Saldo US$
          <input type="number" min={100} step={1000} value={Number.isFinite(balance) ? balance : ''} disabled={!!running} onChange={(e) => setBalance(Number(e.target.value))} onBlur={() => okBalance && save('backtest-balance', balance)} aria-label="Saldo de cada día del backtest" />
        </label>
        <div className="seg mini" role="group" aria-label="Tipo de cuenta del backtest">
          {(['margin', 'cash'] as const).map((a) => (
            <button
              key={a}
              className={account === a ? 'is-active' : ''}
              disabled={!!running}
              onClick={() => {
                setAccount(a);
                save('backtest-account', a);
              }}
            >
              {a === 'margin' ? 'Margen' : 'Cash'}
            </button>
          ))}
        </div>
      </div>
      <div className="ai-row">
        {DAY_CHOICES.map((n) => (
          <button key={n} type="button" className="btn small" disabled={!!running || !okBalance} onClick={() => start(n)}>
            Simular {n} días
          </button>
        ))}
        {running && (
          <button type="button" className="btn small" onClick={cancel}>
            Cancelar
          </button>
        )}
      </div>

      {running && (
        <div className="ai-card bt-progress" aria-live="polite">
          <div className="bt-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((running.day + running.fraction) / running.days.length) * 100)}>
            <i style={{ width: `${((running.day + running.fraction) / running.days.length) * 100}%` }} />
          </div>
          <div className="t-muted small">
            Día {running.day + 1} de {running.days.length} · {fmtDay(running.days[running.day].dayKey)} · {Math.round(running.fraction * 100)} %
            {running.results.length > 0 && ` · hasta ahora ${running.results.reduce((a, r) => a + r.trades.length, 0)} trades, ${fmtSignedMoney(running.results.reduce((a, r) => a + r.net, 0))}`}
            {running.inline && ' · en el hilo principal (la página puede ir más lenta)'}
          </div>
        </div>
      )}
      {error && <div className="ai-paused">{error}</div>}

      {done && <Results r={done} />}
    </div>
  );
}

function Results({ r }: { r: Finished }) {
  const s = r.summary;
  const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  return (
    <>
      <div className="ai-sub">
        {s.days} días · {r.profile} · cuenta {r.account === 'margin' ? 'margen' : 'cash'} de {fmtMoney(r.balance, 0)} por día
      </div>
      <div className="stat-grid bt-stats" data-testid="backtest-results">
        <Stat label="Trades" value={String(s.trades)} sub={`${s.wins} ganadores`} />
        <Stat label="Aciertos" value={s.trades ? `${s.winRate} %` : '–'} />
        <Stat label="R promedio" value={s.trades ? `${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R` : '–'} tone={tone(s.avgR)} />
        <Stat label="Neto" value={fmtSignedMoney(s.net)} tone={tone(s.net)} sub={`${((s.net / r.balance) * 100).toFixed(1)} % del saldo`} />
        <Stat label="Mejor día" value={s.bestDay ? fmtSignedMoney(s.bestDay.net) : '–'} sub={s.bestDay ? fmtDay(s.bestDay.dayKey) : ''} tone={s.bestDay ? tone(s.bestDay.net) : ''} />
        <Stat label="Peor día" value={s.worstDay ? fmtSignedMoney(s.worstDay.net) : '–'} sub={s.worstDay ? fmtDay(s.worstDay.dayKey) : ''} tone={s.worstDay ? tone(s.worstDay.net) : ''} />
        <Stat label="Racha de pérdidas" value={String(s.maxLosingStreak)} sub="perdedores seguidos" />
        <Stat label="Drawdown máx." value={fmtMoney(s.maxDrawdown)} sub="desde un máximo" tone={s.maxDrawdown > 0 ? 'down' : ''} />
      </div>
      {s.trades > 0 && <EquityCurve curve={s.equityCurve} start={r.balance} />}
      <table className="bt-days">
        <thead>
          <tr>
            <th>Día</th>
            <th>Trades</th>
            <th>Aciertos</th>
            <th>R prom.</th>
            <th>Neto</th>
          </tr>
        </thead>
        <tbody>
          {r.results.map((d) => (
            <tr key={d.dayKey}>
              <td>{fmtDay(d.dayKey)}</td>
              <td className="mono">{d.trades.length}</td>
              <td className="mono">{d.trades.length ? `${Math.round((d.wins / d.trades.length) * 100)} %` : '–'}</td>
              <td className="mono">{d.trades.length ? d.avgR.toFixed(2) : '–'}</td>
              <td className={`mono t-${tone(d.net) || 'muted'}`}>{fmtSignedMoney(d.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-muted small ai-note">Un mercado simulado: sirve para comparar perfiles y reglas entre sí, no para prever resultados con plata real.</p>
    </>
  );
}

function Stat({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-sub">{label}</span>
      <span className={`stat-big ${tone ? `t-${tone}` : ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** Curva de capital trade a trade (SVG a mano): la línea punteada es el saldo inicial. */
function EquityCurve({ curve, start }: { curve: number[]; start: number }) {
  const W = 320;
  const H = 90;
  const P = 4;
  let min = start;
  let max = start;
  for (const v of curve) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const x = (i: number) => P + (i / Math.max(1, curve.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const points = curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = curve[curve.length - 1];
  const base = y(start).toFixed(1);
  return (
    <svg className="bt-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Curva de capital: de ${fmtMoney(start)} a ${fmtMoney(last)} en ${curve.length - 1} trades`}>
      <line className="bt-base" x1={0} x2={W} y1={base} y2={base} vectorEffect="non-scaling-stroke" />
      <polyline className={last >= start ? 'up' : 'down'} points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
