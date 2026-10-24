// Cuenta y métricas, al estilo de la pantalla "Account & Metrics" del simulador de Warrior Trading:
// tus aptitudes (ganancias y pérdidas, ganadores, perdedores), la "Profit Trifecta" de Ross Cameron
// (constancia, % de aciertos y relación ganancia/pérdida), la rentabilidad por precio, horario, gap,
// volumen y volumen relativo, el rendimiento por semana, la curva de capital y todos los trades.
import { useMemo, useState, type ReactNode } from 'react';
import { formatEtTime } from '../../engine/time';
import { fmtMoney } from '../../trading/broker';
import { breakdown, DAYS_PER_WEEK, DIMENSIONS, equityCurve, LEVELS, summarize, weeklyResults, type Bucket, type Dimension, type Summary, type WeekResult } from '../../trading/stats';
import { SETUPS, type SessionRecord, type Trade } from '../../trading/types';
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

const mins = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : m >= 1 ? `${m.toFixed(1)} min` : `${Math.max(1, Math.round(m * 60))} s`);

function dayLabel(rec: { dayKey: string; mode: string; startedAt: number; dayIndex?: number }): string {
  const d = new Date(rec.startedAt);
  const when = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (rec.mode !== 'sim') return `En vivo · ${rec.dayKey}`;
  return rec.dayIndex ? `Día ${rec.dayIndex} · ${when}` : `Simulador · ${when}`;
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

/** Barras de resultado neto por grupo, con el cero marcado (verde ganancia, rojo pérdida). */
function ProfitBars({ title, buckets, extra }: { title: string; buckets: Bucket[]; extra?: ReactNode }) {
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b.net)));
  const hasNeg = buckets.some((b) => b.net < 0);
  const hasPos = buckets.some((b) => b.net > 0);
  const zero = hasNeg && hasPos ? 50 : hasNeg ? 100 : 0;
  const scale = hasNeg && hasPos ? 50 : 100;
  return (
    <section className="pbars">
      <header className="pbars-head">
        <h4>{title}</h4>
        {extra}
      </header>
      {buckets.length ? (
        <ul>
          {buckets.map((b) => {
            const w = (Math.abs(b.net) / max) * scale;
            const left = b.net >= 0 ? zero : zero - w;
            return (
              <li key={b.key} title={`${b.trades} trades · ${b.winRate.toFixed(0)}% de aciertos · ${money(b.net)}`}>
                <span className="pb-label">{b.label}</span>
                <span className="pb-track">
                  <span className="pb-zero" style={{ left: `${zero}%` }} />
                  <span className={`pb-bar ${b.net >= 0 ? 'up' : 'down'}`} style={{ left: `${left}%`, width: `${Math.max(0.5, w)}%` }} />
                </span>
                <span className={`pb-val ${b.net >= 0 ? 't-up' : 't-down'}`}>{money(b.net)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-muted small">Sin trades en este período.</p>
      )}
    </section>
  );
}

/** El triángulo de la trifecta: constancia arriba, % de aciertos abajo a la izquierda y G/P a la derecha. */
function Trifecta({ week }: { week?: WeekResult }) {
  const sc = week?.score;
  return (
    <div className="trifecta">
      <svg viewBox="0 0 240 210" role="img" aria-label={sc ? `Trifecta: constancia ${sc.consistency}, aciertos ${sc.winRate}, relación ganancia/pérdida ${sc.plRatio}, total ${sc.total}` : 'Trifecta sin datos'}>
        <polygon points="120,8 180,108 60,108" className="tri-blue" />
        <polygon points="60,108 120,208 0,208" className="tri-green" />
        <polygon points="180,108 240,208 120,208" className="tri-yellow" />
        <polygon points="60,108 180,108 120,208" className="tri-center" />
        <text x="120" y="80" className="tri-n">
          {sc?.consistency ?? '—'}
        </text>
        <text x="60" y="182" className="tri-n">
          {sc?.winRate ?? '—'}
        </text>
        <text x="180" y="182" className="tri-n">
          {sc?.plRatio ?? '—'}
        </text>
        <text x="120" y="152" className="tri-total">
          {sc?.total ?? '—'}
        </text>
      </svg>
      <div className="tri-legend">
        <span>
          <i className="dot blue" /> Constancia
        </span>
        <span>
          <i className="dot green" /> % de aciertos
        </span>
        <span>
          <i className="dot yellow" /> Relación G/P
        </span>
      </div>
    </div>
  );
}

/** Descarga los trades como CSV (en Claude, con el permiso de descargas; si no, con un enlace). */
async function exportCsv(trades: Trade[]): Promise<void> {
  const head = ['fecha', 'hora_et_entrada', 'hora_et_salida', 'simbolo', 'setup', 'acciones', 'entrada', 'salida', 'bruto', 'comisiones', 'neto', 'pct', 'r', 'salida_por', 'nota'];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...trades]
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((t) => [new Date(t.openedAt).toISOString().slice(0, 10), formatEtTime(t.openedAt), formatEtTime(t.closedAt), t.sym, t.setup ?? '', t.shares, t.avgEntry, t.avgExit, t.gross, t.fees, t.net, t.returnPct, t.r ?? '', t.exitReason, t.note ?? ''].map(esc).join(','));
  const data = [head.join(','), ...rows].join('\n');
  const filename = `pulso-trades-${new Date().toISOString().slice(0, 10)}.csv`;
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  const dl = claude?.use ? ((await claude.use('downloads').catch(() => null)) as { save(f: { filename: string; data: string }): Promise<unknown> } | null) : null;
  if (dl) {
    await dl.save({ filename, data }).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Journal({ c, onClose, onSelect, onSettings }: { c: TrainingController; onClose?: () => void; onSelect: (sym: string) => void; onSettings: () => void }) {
  const [scope, setScope] = useState<Scope>('all');
  const [dim, setDim] = useState<Dimension>('setup');
  const [hourStep, setHourStep] = useState<'hora' | 'hora30' | 'hora15'>('hora30');
  const [review, setReview] = useState<Trade | null>(null);
  const [startMin, setStartMin] = useState(c.state.settings.startMinutes);
  const a = c.active;
  const sessions = c.sessions;

  const trades = useMemo(() => {
    const current = a?.trades ?? [];
    if (scope === 'today') return a ? current : (c.lastEnded?.trades ?? sessions[0]?.trades ?? []);
    const history = sessions.flatMap((s) => s.trades);
    if (scope === 'all') return [...current, ...history];
    if (scope === 'week') {
      const from = (a?.dayIndex ?? c.state.dayIndex) - DAYS_PER_WEEK + 1;
      return [...current, ...sessions.filter((s) => (s.dayIndex ?? 0) >= from).flatMap((s) => s.trades)];
    }
    return sessions.find((s) => s.id === scope)?.trades ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, a, a?.trades.length, sessions, c.lastEnded]);

  // Semanas de práctica: todos los trades, con el día de práctica de cada uno.
  const weeks = useMemo(() => {
    const dayOfSession = new Map<string, number>();
    for (const x of sessions) if (x.dayIndex) dayOfSession.set(x.id, x.dayIndex);
    if (a) dayOfSession.set(a.id, a.dayIndex);
    const all = [...(a?.trades ?? []), ...sessions.flatMap((x) => x.trades)];
    return weeklyResults(all, (t) => dayOfSession.get(t.sessionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, a, a?.trades.length]);
  const lastWeek = weeks[weeks.length - 1];

  const s = summarize(trades);
  const gross = trades.reduce((x, t) => x + t.gross, 0);
  const daysInScope = new Set(trades.map((t) => t.sessionId)).size || 1;
  const sorted = [...trades].sort((x, y) => y.closedAt - x.closedAt);
  const startForCurve =
    scope === 'today' && a ? a.startCash : scope === 'today' && c.lastEnded ? c.lastEnded.startCash : (sessions.find((x) => x.id === scope)?.startCash ?? c.capital);
  const sum = c.summary();
  const rows = breakdown(trades, dim);

  return (
    <div className="journal">
      <header className="journal-head">
        <div>
          <h2>Cuenta y métricas</h2>
          <p className="t-muted small">
            {c.storeKind === 'cuenta' ? 'Se guarda en tu cuenta de Claude: lo ves desde cualquier dispositivo.' : 'Se guarda en este navegador.'} Solo compras (long), dinero ficticio.
          </p>
        </div>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconClose />
          </button>
        )}
      </header>

      <section className="journal-account">
        <div className="big-stat">
          <span className="stat-label">Equity</span>
          <span className="big">{fmtMoney(sum.equity)}</span>
          <span className={sum.dayPnl > 0 ? 't-up' : sum.dayPnl < 0 ? 't-down' : 't-muted'}>Hoy {money(sum.dayPnl)}</span>
        </div>
        <div className="big-stat">
          <span className="stat-label">Resultado total</span>
          <span className={`big ${sum.equity - c.capital >= 0 ? 't-up' : 't-down'}`}>{money(sum.equity - c.capital)}</span>
          <span className="t-muted">sobre {fmtMoney(c.capital)} puestos en la cuenta</span>
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
          <button className="btn ghost" onClick={onSettings}>
            Ajustes de la cuenta
          </button>
        </div>
      </section>

      <div className="chips scope" role="group" aria-label="Período">
        {(
          [
            ['today', a ? 'Hoy' : 'Último día'],
            ['week', 'Últimos 5 días'],
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

      <h3 className="section-title">Tus aptitudes</h3>
      <section className="apt-grid">
        <div className="apt apt-blue">
          <h4>Ganancias y pérdidas</h4>
          <dl>
            <div>
              <dt>Relación G/P</dt>
              <dd>{s.wins && s.losses ? `${ratio(s.plRatio)} : 1` : '—'}</dd>
            </div>
            <div>
              <dt>Resultado bruto</dt>
              <dd>{money(Math.round(gross * 100) / 100)}</dd>
            </div>
            <div>
              <dt>Resultado neto</dt>
              <dd className={s.net >= 0 ? 't-up' : 't-down'}>{money(s.net)}</dd>
            </div>
            <div>
              <dt>Comisiones y tasas</dt>
              <dd>{fmtMoney(s.fees)}</dd>
            </div>
            <div>
              <dt>Promedio por día</dt>
              <dd>{money(Math.round((s.net / daysInScope) * 100) / 100)}</dd>
            </div>
            <div>
              <dt>% de aciertos</dt>
              <dd>{s.trades ? `${s.winRate.toFixed(1)}%` : '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="apt apt-green">
          <h4>Ganadores ({s.wins})</h4>
          <dl>
            <div>
              <dt>Ganancia promedio</dt>
              <dd>{s.wins ? money(s.avgWin) : '—'}</dd>
            </div>
            <div>
              <dt>Tiempo promedio de las ganadoras</dt>
              <dd>{s.wins ? mins(s.avgWinHoldMin) : '—'}</dd>
            </div>
            <div>
              <dt>Mayor ganancia</dt>
              <dd>{s.wins ? money(s.largestWin) : '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="apt apt-red">
          <h4>Perdedores ({s.losses})</h4>
          <dl>
            <div>
              <dt>Pérdida promedio</dt>
              <dd>{s.losses ? money(s.avgLoss) : '—'}</dd>
            </div>
            <div>
              <dt>Tiempo promedio de las perdedoras</dt>
              <dd>{s.losses ? mins(s.avgLossHoldMin) : '—'}</dd>
            </div>
            <div>
              <dt>Mayor pérdida</dt>
              <dd>{s.losses ? money(s.largestLoss) : '—'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="stat-grid">
        {(
          [
            ['Trades', `${s.trades}`, `${s.wins} ganadores · ${s.losses} perdedores`],
            ['Profit factor', ratio(s.profitFactor), 'total ganado / total perdido'],
            ['R promedio', s.avgR !== undefined ? `${s.avgR.toFixed(2)}R` : '—', 'en trades con stop'],
            ['Esperanza', s.trades ? money(s.expectancy) : '—', 'resultado medio por trade'],
            ['Máx. drawdown', s.trades ? fmtMoney(-s.maxDrawdown) : '—', 'mayor caída desde un máximo'],
            ['Rachas', s.trades ? `${s.bestStreak} / ${s.worstStreak}` : '—', 'ganadores / perdedores seguidos'],
          ] as Array<[string, string, string]>
        ).map(([label, value, sub]) => (
          <div key={label} className="stat-card">
            <span className="stat-label">{label}</span>
            <span className={`stat-big ${label === 'Esperanza' ? (s.net > 0 ? 't-up' : s.net < 0 ? 't-down' : '') : ''}`}>{value}</span>
            <span className="stat-sub">{sub}</span>
          </div>
        ))}
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
        <div className="journal-block trifecta-block">
          <h3 className="sub" title="Ross Cameron mide su rendimiento con tres números: constancia (semanas positivas seguidas), % de aciertos y relación ganancia/pérdida. Cada uno vale de 1 a 6.">
            Profit Trifecta · {lastWeek ? `semana ${lastWeek.week}` : 'sin semanas'}
          </h3>
          <div className="trifecta-row">
            <Trifecta week={lastWeek} />
            <table className="grid-table levels">
              <thead>
                <tr>
                  <th>Puntaje</th>
                  <th>Nivel</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map(([lo, hi, label]) => (
                  <tr key={label} className={lastWeek && lastWeek.score.total >= lo && lastWeek.score.total <= hi ? 'is-selected' : ''}>
                    <td>
                      {lo}–{hi}
                    </td>
                    <td>{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {weeks.length > 1 && (
            <div className="table-wrap">
              <table className="grid-table lookback">
                <thead>
                  <tr>
                    <th>Semana</th>
                    {weeks.slice(-6).map((w) => (
                      <th key={w.week} className="num">
                        {w.week}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>% de aciertos</td>
                    {weeks.slice(-6).map((w) => (
                      <td key={w.week} className="num">
                        {w.trades ? `${w.winRate.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Relación G/P</td>
                    {weeks.slice(-6).map((w) => (
                      <td key={w.week} className="num">
                        {w.trades ? `${w.plRatio.toFixed(2)}:1` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Trifecta</td>
                    {weeks.slice(-6).map((w) => (
                      <td key={w.week} className="num">
                        {w.score.total}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="t-muted small">Una semana de práctica son {DAYS_PER_WEEK} días simulados. La constancia cuenta las semanas positivas seguidas.</p>
        </div>
      </section>

      <h3 className="section-title">Rentabilidad</h3>
      <section className="pbars-grid">
        <ProfitBars title="Por precio" buckets={breakdown(trades, 'precio')} />
        <ProfitBars
          title="Por horario"
          buckets={breakdown(trades, hourStep)}
          extra={
            <span className="seg mini" role="group" aria-label="Intervalo">
              {(
                [
                  ['hora', '1 h'],
                  ['hora30', '30 min'],
                  ['hora15', '15 min'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={hourStep === k ? 'is-active' : ''} onClick={() => setHourStep(k)}>
                  {label}
                </button>
              ))}
            </span>
          }
        />
        <ProfitBars title="Por gap del día" buckets={breakdown(trades, 'gap')} />
        <ProfitBars title="Por volumen" buckets={breakdown(trades, 'volumen')} />
        <ProfitBars title="Por volumen relativo" buckets={breakdown(trades, 'rvol')} />
        <ProfitBars title="Por setup" buckets={breakdown(trades, 'setup')} />
      </section>

      <h3 className="section-title">Rendimiento por semana</h3>
      {weeks.length ? (
        <div className="table-wrap">
          <table className="grid-table weekly">
            <thead>
              <tr>
                <th>Semana</th>
                {Array.from({ length: DAYS_PER_WEEK }, (_, i) => (
                  <th key={i} className="num">
                    Día {i + 1}
                  </th>
                ))}
                <th className="num">Neto semana</th>
              </tr>
            </thead>
            <tbody>
              {weeks
                .slice(-8)
                .reverse()
                .map((w) => (
                  <tr key={w.week}>
                    <td>Semana {w.week}</td>
                    {Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
                      const d = w.days.find((x) => x.dayIndex === (w.week - 1) * DAYS_PER_WEEK + i + 1);
                      return (
                        <td key={i} className={`num day-cell ${d ? (d.net > 0 ? 'pos' : d.net < 0 ? 'neg' : '') : 'empty'}`} title={d ? `Día ${d.dayIndex}: ${d.trades} trades` : 'Sin trades'}>
                          {d ? money(d.net) : ''}
                        </td>
                      );
                    })}
                    <td className={`num ${w.net >= 0 ? 't-up' : 't-down'}`}>
                      <b>{money(w.net)}</b>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="t-muted small">Las semanas aparecen con el primer trade cerrado.</p>
      )}

      <section className="journal-block">
        <div className="chips" role="group" aria-label="Desglose">
          {DIMENSIONS.map((d) => (
            <button key={d.id} className={`chip ${dim === d.id ? 'is-active' : ''}`} onClick={() => setDim(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="grid-table">
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
        ) : null}
      </section>

      <section className="journal-block">
        <div className="block-head">
          <h3 className="sub">Trades ({sorted.length})</h3>
          {c.allTrades().length > 0 && (
            <button className="btn-small" onClick={() => void exportCsv(c.allTrades())}>
              Exportar todo (CSV)
            </button>
          )}
        </div>
        {sorted.length === 0 ? (
          <p className="t-muted small">Todavía no hay trades. Elegí una acción del escáner y comprá desde el ticket.</p>
        ) : (
          <div className="table-wrap">
            <table className="grid-table trades">
              <thead>
                <tr>
                  <th>Hora ET</th>
                  <th>Sím.</th>
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
                    <td className="t-muted">{formatEtTime(t.openedAt, false)}</td>
                    <td>
                      <button className="link sym-link" onClick={() => onSelect(t.sym)}>
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
            <table className="grid-table">
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
