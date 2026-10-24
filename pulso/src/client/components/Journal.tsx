// Diario de trading: estadísticas, curva de capital, desgloses, trades con etiquetas y notas, días
// anteriores y los ajustes de la cuenta de práctica.
import { useMemo, useState } from 'react';
import { formatEtTime } from '../../engine/time';
import { fmtMoney } from '../../trading/broker';
import { breakdown, DIMENSIONS, equityCurve, summarize, type Dimension, type Summary } from '../../trading/stats';
import { SETUPS, type SessionRecord, type Trade, type TradingSettings } from '../../trading/types';
import { fmtPct, fmtPrice } from '../lib/format';
import type { TrainingController } from '../training';
import { IconClose } from './Icons';
import { TradeReview } from './TradeReview';

type Scope = 'today' | 'week' | 'all' | string;

const START_OPTIONS: Array<[number, string]> = [
  [7 * 60, '7:00 (pre-market)'],
  [9 * 60, '9:00'],
  [9 * 60 + 25, '9:25 (antes de la apertura)'],
  [9 * 60 + 45, '9:45'],
];

function money(v: number, sign = true): string {
  return `${sign && v > 0 ? '+' : ''}${fmtMoney(v)}`;
}

function ratio(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  return v ? v.toFixed(2) : '—';
}

function dayLabel(rec: { dayKey: string; mode: string; startedAt: number }): string {
  const d = new Date(rec.startedAt);
  const when = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return rec.mode === 'sim' ? `Simulado · ${when}` : `En vivo · ${rec.dayKey}`;
}

/** Consejos a partir de las estadísticas (al estilo de la revisión diaria de un trader). */
function insights(trades: Trade[], s: Summary): string[] {
  const out: string[] = [];
  if (s.trades < 3) return ['Con pocos trades las estadísticas todavía no dicen mucho: practicá varios días.'];
  if (s.losses > 0 && s.plRatio < 1) out.push('Tu pérdida promedio es mayor que tu ganancia promedio: respetá el stop y buscá entradas con relación 2:1.');
  if (s.trades >= 10 && s.winRate < 40) out.push('Acertás menos del 40%: operá menos y solo los setups más claros (4 o 5 pilares).');
  if (s.winRate >= 50 && s.plRatio >= 1.5 && s.net > 0) out.push('Buen equilibrio entre aciertos y tamaño de las ganancias: mantené el mismo proceso.');
  const noStop = trades.filter((t) => t.r === undefined).length;
  if (noStop / trades.length > 0.5) out.push('Más de la mitad de tus trades no tenía stop al entrar: sin stop no se puede medir el riesgo (R).');
  const hours = breakdown(trades, 'hora').filter((b) => b.trades >= 3);
  if (hours.length > 1) {
    const best = [...hours].sort((a, b) => b.net - a.net)[0];
    const worst = [...hours].sort((a, b) => a.net - b.net)[0];
    if (best.net > 0) out.push(`Tu mejor horario: ${best.label} (${money(best.net)} en ${best.trades} trades).`);
    if (worst.net < 0 && worst.key !== best.key) out.push(`El horario que más te cuesta: ${worst.label} (${money(worst.net)}).`);
  }
  const setups = breakdown(trades, 'setup').filter((b) => b.trades >= 3 && b.key !== '—');
  const worstSetup = [...setups].sort((a, b) => a.net - b.net)[0];
  if (worstSetup && worstSetup.net < 0) out.push(`El setup que más te cuesta: ${worstSetup.label} (${money(worstSetup.net)}).`);
  if (s.avgLossHoldMin > s.avgWinHoldMin * 1.5 && s.losses >= 3) out.push('Mantenés las perdedoras más tiempo que las ganadoras: cortá antes las que no funcionan.');
  return out.length ? out : ['Sin alertas en tus números. Seguí registrando el setup de cada trade para afinar el análisis.'];
}

function EquityChart({ trades, start }: { trades: Trade[]; start: number }) {
  const pts = equityCurve(trades, start);
  if (pts.length < 2) return <p className="t-muted small">La curva aparece con el primer trade cerrado.</p>;
  const W = 600;
  const H = 150;
  const pad = { l: 8, r: 8, t: 12, b: 18 };
  const ys = pts.map((p) => p.equity);
  const lo = Math.min(...ys, start);
  const hi = Math.max(...ys, start);
  // Escala con un mínimo de US$ 2 de alto para que una curva casi plana no se vea como un desplome.
  const min = hi - lo < 1 ? lo - 1 : lo;
  const max = hi - lo < 1 ? hi + 1 : hi;
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const up = last.equity >= start;
  return (
    <div className="equity">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Curva de capital: de ${fmtMoney(start)} a ${fmtMoney(last.equity)} en ${pts.length - 1} trades`}>
        <path d={area} className={`eq-area ${up ? 'up' : 'down'}`} />
        <line x1={pad.l} x2={W - pad.r} y1={y(start)} y2={y(start)} className="eq-base" />
        <path d={line} className={`eq-line ${up ? 'up' : 'down'}`} vectorEffect="non-scaling-stroke" />
        <circle cx={x(pts.length - 1)} cy={y(last.equity)} r="3.5" className={`eq-dot ${up ? 'up' : 'down'}`} />
      </svg>
      <div className="eq-labels mono">
        <span>Inicio {fmtMoney(start)}</span>
        <span>
          Máx. {fmtMoney(hi)} · Mín. {fmtMoney(lo)}
        </span>
        <span className={up ? 't-up' : 't-down'} title="Saldo con los trades cerrados (sin la posición abierta)">
          Realizado {fmtMoney(last.equity)}
        </span>
      </div>
    </div>
  );
}

function SettingsForm({ c }: { c: TrainingController }) {
  const [s, setS] = useState<TradingSettings>(c.state.settings);
  const field = (k: keyof TradingSettings, label: string, step = '1', hint?: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        id={`trade-set-${k}`}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={String(s[k])}
        onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
  return (
    <form
      className="journal-settings"
      onSubmit={(e) => {
        e.preventDefault();
        c.updateSettings(s);
        c.notify('Ajustes de práctica guardados.', 'ok');
      }}
    >
      <div className="grid-fields">
        {field('startingBalance', 'Saldo inicial (US$)', '100', 'Se aplica al reiniciar la cuenta')}
        {field('defaultShares', 'Acciones por defecto')}
        {field('defaultRisk', 'Riesgo por trade (US$)', '5', 'Para el botón "Riesgo"')}
        {field('maxDailyLoss', 'Pérdida máxima del día (US$)', '10', '0 = sin límite; bloquea nuevas compras')}
        {field('commissionPerShare', 'Comisión por acción (US$)', '0.001', 'Ej.: 0,005 como IBKR Pro')}
        {field('minCommission', 'Comisión mínima por orden (US$)', '0.1')}
        <label className="field">
          <span className="field-label">Cuenta</span>
          <select id="trade-set-margin" value={s.margin} onChange={(e) => setS({ ...s, margin: Number(e.target.value) as 1 | 2 | 4 })}>
            <option value={1}>Cash (sin margen)</option>
            <option value={2}>Margen 2x</option>
            <option value={4}>Margen 4x (requiere US$ 25.000 en EE.UU.)</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Deslizamiento</span>
          <select id="trade-set-slippage" value={s.slippage ? '1' : '0'} onChange={(e) => setS({ ...s, slippage: e.target.value === '1' })}>
            <option value="1">Realista (según volumen)</option>
            <option value="0">Sin deslizamiento</option>
          </select>
        </label>
      </div>
      <div className="row-end">
        <button type="submit" className="btn primary">
          Guardar ajustes
        </button>
      </div>
    </form>
  );
}

export function Journal({ c, onClose, onSelect }: { c: TrainingController; onClose?: () => void; onSelect: (sym: string) => void }) {
  const [scope, setScope] = useState<Scope>('today');
  const [dim, setDim] = useState<Dimension>('setup');
  const [review, setReview] = useState<Trade | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [startMin, setStartMin] = useState(c.state.settings.startMinutes);
  const a = c.active;
  const sessions = c.sessions;

  const trades = useMemo(() => {
    const current = a?.trades ?? [];
    if (scope === 'today') return a ? current : (c.lastEnded?.trades ?? sessions[0]?.trades ?? []);
    const history = sessions.flatMap((s) => s.trades);
    if (scope === 'all') return [...current, ...history];
    if (scope === 'week') {
      const from = Date.now() - 7 * 86_400_000;
      return [...current, ...sessions.filter((s) => s.endedAt >= from).flatMap((s) => s.trades)];
    }
    return sessions.find((s) => s.id === scope)?.trades ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, a, a?.trades.length, sessions, c.lastEnded]);

  const s = summarize(trades);
  const sorted = [...trades].sort((x, y) => y.closedAt - x.closedAt);
  const startForCurve =
    scope === 'today' && a ? a.startCash : scope === 'today' && c.lastEnded ? c.lastEnded.startCash : (sessions.find((x) => x.id === scope)?.startCash ?? c.state.settings.startingBalance);
  const sum = c.summary();
  const rows = breakdown(trades, dim);

  return (
    <div className="journal">
      <header className="journal-head">
        <div>
          <h2>Diario de trading</h2>
          <p className="t-muted small">
            {c.storeKind === 'cuenta' ? 'Se guarda en tu cuenta de Claude: lo ves desde cualquier dispositivo.' : 'Se guarda en este navegador.'} Solo compras (long), dinero ficticio.
          </p>
        </div>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar el diario">
            <IconClose />
          </button>
        )}
      </header>

      <section className="journal-account">
        <div className="big-stat">
          <span className="stat-label">Equity</span>
          <span className="big mono">{fmtMoney(sum.equity)}</span>
          <span className={`mono ${sum.dayPnl > 0 ? 't-up' : sum.dayPnl < 0 ? 't-down' : 't-muted'}`}>Hoy {money(sum.dayPnl)}</span>
        </div>
        <div className="big-stat">
          <span className="stat-label">Resultado total</span>
          <span className={`big mono ${sum.equity - c.state.settings.startingBalance >= 0 ? 't-up' : 't-down'}`}>{money(sum.equity - c.state.settings.startingBalance)}</span>
          <span className="mono t-muted">desde {fmtMoney(c.state.settings.startingBalance)}</span>
        </div>
        <div className="journal-actions">
          {a ? (
            <button className="btn" onClick={() => c.endDay()}>
              Terminar el día
            </button>
          ) : (
            <span className="t-muted small">Día terminado.</span>
          )}
          {c.mode === 'local' && (
            <div className="new-day">
              <select id="journal-start" value={startMin} onChange={(e) => setStartMin(Number(e.target.value))} aria-label="Hora de inicio del nuevo día">
                {START_OPTIONS.map(([m, label]) => (
                  <option key={m} value={m}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="btn primary" onClick={() => (c.newDay(startMin), onClose?.())}>
                Nuevo día simulado
              </button>
            </div>
          )}
          <button className="btn ghost" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Ocultar ajustes' : 'Ajustes de práctica'}
          </button>
          {!confirmReset ? (
            <button className="btn ghost" onClick={() => setConfirmReset(true)}>
              Reiniciar cuenta
            </button>
          ) : (
            <div className="confirm">
              <span>¿Reiniciar a {fmtMoney(c.state.settings.startingBalance)}?</span>
              <button className="btn-small" onClick={() => (c.resetAccount(false), setConfirmReset(false))}>
                Sí, conservar historial
              </button>
              <button className="btn-small sell" onClick={() => (c.resetAccount(true), setConfirmReset(false))}>
                Sí, borrar todo
              </button>
              <button className="btn-small" onClick={() => setConfirmReset(false)}>
                No
              </button>
            </div>
          )}
        </div>
      </section>

      {showSettings && <SettingsForm c={c} />}

      <div className="chips scope" role="group" aria-label="Período">
        {(
          [
            ['today', a ? 'Hoy' : 'Último día'],
            ['week', 'Últimos 7 días'],
            ['all', 'Todo'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`chip ${scope === k ? 'is-active' : ''}`} onClick={() => setScope(k)}>
            {label}
          </button>
        ))}
        {sessions.length > 0 && (
          <select id="journal-session" className="chip-select-inline" value={sessions.some((x) => x.id === scope) ? scope : ''} onChange={(e) => e.target.value && setScope(e.target.value)} aria-label="Elegir un día">
            <option value="">Elegir un día…</option>
            {sessions.map((x: SessionRecord) => (
              <option key={x.id} value={x.id}>
                {dayLabel(x)} · {x.trades.length} trades · {money(x.endCash - x.startCash)}
              </option>
            ))}
          </select>
        )}
      </div>

      <section className="stat-grid">
        {(
          [
            ['Trades', `${s.trades}`, `${s.wins} ganadores · ${s.losses} perdedores`],
            ['Resultado', money(s.net), s.fees ? `comisiones ${fmtMoney(s.fees)}` : 'sin comisiones'],
            ['% de aciertos', s.trades ? `${s.winRate.toFixed(0)}%` : '—', 'trades ganadores / total'],
            ['Ganancia promedio', s.wins ? money(s.avgWin) : '—', `mayor ${money(s.largestWin)}`],
            ['Pérdida promedio', s.losses ? money(s.avgLoss) : '—', `mayor ${money(s.largestLoss)}`],
            ['Relación G/P', ratio(s.plRatio), 'ganancia prom. / pérdida prom.'],
            ['Profit factor', ratio(s.profitFactor), 'total ganado / total perdido'],
            ['R promedio', s.avgR !== undefined ? `${s.avgR.toFixed(2)}R` : '—', 'en trades con stop'],
            ['Esperanza', s.trades ? money(s.expectancy) : '—', 'resultado medio por trade'],
            ['Máx. drawdown', s.trades ? fmtMoney(-s.maxDrawdown) : '—', 'mayor caída desde un máximo'],
            ['Rachas', s.trades ? `${s.bestStreak} / ${s.worstStreak}` : '—', 'ganadores / perdedores seguidos'],
            ['Tiempo promedio', s.trades ? `${s.avgHoldMin.toFixed(1)} min` : '—', s.trades ? `gana ${s.avgWinHoldMin.toFixed(1)} · pierde ${s.avgLossHoldMin.toFixed(1)}` : ''],
          ] as Array<[string, string, string]>
        ).map(([label, value, sub]) => {
          const tone = label === 'Resultado' || label === 'Esperanza' ? (s.net > 0 ? 't-up' : s.net < 0 ? 't-down' : '') : '';
          return (
            <div key={label} className="stat-card">
              <span className="stat-label">{label}</span>
              <span className={`stat-big mono ${tone}`}>{value}</span>
              <span className="stat-sub">{sub}</span>
            </div>
          );
        })}
      </section>

      <section className="journal-two">
        <div className="journal-block">
          <h3 className="sub">Curva de capital</h3>
          <EquityChart trades={trades} start={startForCurve} />
          <ul className="insights">
            {insights(trades, s).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="journal-block">
          <div className="chips" role="group" aria-label="Desglose">
            {DIMENSIONS.map((d) => (
              <button key={d.id} className={`chip ${dim === d.id ? 'is-active' : ''}`} onClick={() => setDim(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          {rows.length ? (
            <div className="table-wrap">
              <table className="scan">
                <thead>
                  <tr>
                    <th>{DIMENSIONS.find((d) => d.id === dim)?.label}</th>
                    <th className="num">Trades</th>
                    <th className="num">Aciertos</th>
                    <th className="num">Resultado</th>
                    <th className="num">Promedio</th>
                    <th className="num">R prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="num">{b.trades}</td>
                      <td className="num">{b.winRate.toFixed(0)}%</td>
                      <td className={`num ${b.net >= 0 ? 't-up' : 't-down'}`}>{money(b.net)}</td>
                      <td className="num">{money(b.avg)}</td>
                      <td className="num">{b.avgR !== undefined ? `${b.avgR.toFixed(2)}R` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="t-muted small">Sin trades en este período.</p>
          )}
        </div>
      </section>

      <section className="journal-block">
        <h3 className="sub">Trades ({sorted.length})</h3>
        {sorted.length === 0 ? (
          <p className="t-muted small">Todavía no hay trades. Elegí una acción del escáner y comprá desde el ticket de la ficha.</p>
        ) : (
          <div className="table-wrap">
            <table className="scan trades">
              <thead>
                <tr>
                  <th>Hora ET</th>
                  <th>Símb.</th>
                  <th>Setup</th>
                  <th className="num">Acc.</th>
                  <th className="num">Entrada</th>
                  <th className="num">Salida</th>
                  <th className="num">Resultado</th>
                  <th className="num">%</th>
                  <th className="num">R</th>
                  <th className="num">Min.</th>
                  <th>Salió por</th>
                  <th>Nota</th>
                  <th aria-label="Revisar" />
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 300).map((t) => (
                  <tr key={t.id}>
                    <td className="mono t-muted">{formatEtTime(t.openedAt, false)}</td>
                    <td className="c-sym">
                      <button className="link-btn" onClick={() => onSelect(t.sym)}>
                        {t.sym}
                      </button>
                    </td>
                    <td>
                      <select id={`setup-${t.id}`} className="inline-select" value={t.setup ?? ''} onChange={(e) => c.updateTrade(t.id, { setup: e.target.value || undefined })} aria-label="Setup del trade">
                        <option value="">—</option>
                        {SETUPS.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">{t.shares}</td>
                    <td className="num">{fmtPrice(t.avgEntry)}</td>
                    <td className="num">{fmtPrice(t.avgExit)}</td>
                    <td className={`num ${t.net >= 0 ? 't-up' : 't-down'}`}>{money(t.net)}</td>
                    <td className="num">{fmtPct(t.returnPct)}</td>
                    <td className="num">{t.r !== undefined ? `${t.r.toFixed(1)}R` : '—'}</td>
                    <td className="num">{((t.closedAt - t.openedAt) / 60_000).toFixed(1)}</td>
                    <td>{{ manual: 'Manual', stop: 'Stop', target: 'Objetivo', eod: 'Cierre' }[t.exitReason]}</td>
                    <td>
                      <input
                        id={`note-${t.id}`}
                        className="inline-input"
                        defaultValue={t.note ?? ''}
                        placeholder="¿Qué aprendiste?"
                        onBlur={(e) => e.target.value !== (t.note ?? '') && c.updateTrade(t.id, { note: e.target.value || undefined })}
                        aria-label="Nota del trade"
                      />
                    </td>
                    <td>
                      <button className="btn-small" onClick={() => setReview(t)} disabled={!t.bars?.length}>
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="journal-block">
          <h3 className="sub">Días anteriores</h3>
          <div className="table-wrap">
            <table className="scan">
              <thead>
                <tr>
                  <th>Día</th>
                  <th className="num">Trades</th>
                  <th className="num">Aciertos</th>
                  <th className="num">Resultado</th>
                  <th className="num">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 60).map((x) => {
                  const ss = summarize(x.trades);
                  return (
                    <tr key={x.id} onClick={() => setScope(x.id)} className={scope === x.id ? 'is-selected' : ''}>
                      <td>{dayLabel(x)}</td>
                      <td className="num">{ss.trades}</td>
                      <td className="num">{ss.trades ? `${ss.winRate.toFixed(0)}%` : '—'}</td>
                      <td className={`num ${ss.net >= 0 ? 't-up' : 't-down'}`}>{money(ss.net)}</td>
                      <td className="num">{fmtMoney(x.endCash)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {review && <TradeReview trade={review} onClose={() => setReview(null)} />}
    </div>
  );
}
