// Nuevo día: "Mercado ahora" (la hora real de Nueva York, con pre-market y after-hours) o un día de
// práctica con la fecha y la hora que elijas. Los eventos son al azar; "Repetir" vuelve a dar el mismo
// mercado de un día que ya practicaste, desde la misma hora.
import { useEffect, useState } from 'react';
import { etParts, formatCountdown, formatEtTime, SESSION_LABEL } from '../../engine/time';
import { fmtMoney } from '../lib/format';
import { summarize } from '../../trading/stats';
import type { SessionRecord } from '../../trading/types';
import { fmtDay, fmtMinutes, fromHHMM, HEAT_LABEL, lastSessionKey, postEnd, resolveDay, toHHMM } from '../lib/days';
import { nyMarket, type TrainingController } from '../training';
import { IconClose } from './Icons';

const START_CHIPS: Array<[number, string]> = [
  [4 * 60, '4:00 pre-market'],
  [7 * 60, '7:00'],
  [9 * 60, '9:00'],
  [9 * 60 + 25, '9:25 antes de la apertura'],
  [9 * 60 + 45, '9:45'],
  [12 * 60, '12:00 mediodía'],
  [15 * 60 + 30, '15:30 última media hora'],
  [16 * 60, '16:00 after-hours'],
];

/** Hora de inicio permitida para ese día: de las 4:00 hasta media hora antes del fin del after-hours. */
function clampStart(m: number, dayKey: string): number {
  return Math.min(Math.max(4 * 60, Math.round(m)), postEnd(dayKey) - 30);
}

function fmtOpen(ts: number, now: number): string {
  const day = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/New_York' }).format(ts);
  return `${day} a las ${fmtMinutes(etParts(ts).minutes)} ET (en ${formatCountdown(ts - now)})`;
}

export function NewDayDialog({ c, onClose, initialMode }: { c: TrainingController; onClose: () => void; initialMode?: 'ny' | 'practice' }) {
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<'ny' | 'practice'>(initialMode ?? c.state.settings.clock);
  const [date, setDate] = useState(() => lastSessionKey());
  const [start, setStart] = useState(c.state.settings.startMinutes);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const ny = nyMarket(now);
  const day = resolveDay(date);
  const startAt = clampStart(start, day.key);
  const a = c.active;
  const ends = !!a && (a.positions.length > 0 || a.trades.length > 0);
  const replayable: Array<{ id: string; label: string; detail: string; day: SessionRecord | NonNullable<typeof a> }> = [];
  if (a && c.canReplay(a)) replayable.push({ id: a.id, label: 'El día actual', detail: `${fmtDay(a.dayKey)} desde las ${fmtMinutes(a.startMinutes ?? c.state.settings.startMinutes)}`, day: a });
  for (const s of c.sessions) {
    if (replayable.length >= 4) break;
    if (!c.canReplay(s)) continue;
    const sum = summarize(s.trades);
    replayable.push({ id: s.id, label: `${fmtDay(s.dayKey)} desde las ${fmtMinutes(s.startMinutes ?? 9 * 60 + 25)}`, detail: `${sum.trades} trades · ${sum.net >= 0 ? '+' : ''}${fmtMoney(sum.net)}${s.heat ? ` · ${HEAT_LABEL[s.heat]}` : ''}`, day: s });
  }

  const begin = () => {
    if (mode === 'ny') c.newDay({ clock: 'ny' });
    else c.newDay({ clock: 'practice', date: day.key, startMinutes: startAt });
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal newday-modal" role="dialog" aria-modal="true" aria-labelledby="nd-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="nd-title">Nuevo día</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconClose />
          </button>
        </header>

        <div className="nd-modes" role="radiogroup" aria-label="Reloj del día">
          <button type="button" role="radio" aria-checked={mode === 'ny'} className={`nd-mode ${mode === 'ny' ? 'is-active' : ''}`} onClick={() => setMode('ny')}>
            <b>Mercado ahora</b>
            <span>La hora real de Nueva York: pre-market desde las 4:00, rueda de 9:30 a 16:00 y after-hours hasta las 20:00. Sin pausa ni velocidad: si cerrás la página, al volver el mercado se pone al día.</span>
            <em className={ny.open ? 't-up' : 't-warn'}>{ny.open ? `Abierto: ${SESSION_LABEL[ny.session].toLowerCase()} · ${formatEtTime(now, false)} ET` : `Cerrado: abre el ${fmtOpen(ny.nextOpen, now)}`}</em>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'practice'} className={`nd-mode ${mode === 'practice' ? 'is-active' : ''}`} onClick={() => setMode('practice')}>
            <b>Día de práctica</b>
            <span>Un día simulado en la fecha y a la hora que elijas, a cualquier hora del día. Podés pausar o acelerar el reloj.</span>
            <em className="t-muted">{fmtDay(day.key)} desde las {fmtMinutes(startAt)} ET</em>
          </button>
        </div>

        {mode === 'ny' && !ny.open && (
          <p className="nd-note">Si lo elegís ahora, el día arranca solo cuando abra el pre-market. Mientras tanto podés practicar con un día simulado.</p>
        )}

        {mode === 'practice' && (
          <div className="nd-fields">
            <label className="field">
              <span className="field-label">Fecha</span>
              <input id="nd-date" type="date" min="2025-01-02" max="2027-12-31" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Hora de inicio (ET)</span>
              <input
                id="nd-start"
                type="time"
                min="04:00"
                max={toHHMM(postEnd(day.key) - 30)}
                step={60}
                value={toHHMM(startAt)}
                onChange={(e) => {
                  const m = fromHHMM(e.target.value);
                  if (m !== undefined) setStart(m);
                }}
              />
            </label>
            <div className="chips nd-chips" role="group" aria-label="Horas rápidas">
              {START_CHIPS.filter(([m]) => m < postEnd(day.key) - 30).map(([m, label]) => (
                <button key={m} type="button" className={`chip ${startAt === m ? 'is-active' : ''}`} onClick={() => setStart(m)}>
                  {label}
                </button>
              ))}
            </div>
            {day.notes.map((n) => (
              <p key={n} className="nd-note">
                {n}
              </p>
            ))}
            <p className="t-muted small">Los gappers, las noticias, los halts y las ofertas de acciones salen al azar: cada día es distinto y puede tocar uno frío, normal o caliente.</p>
          </div>
        )}

        {ends && <p className="nd-note warn">Tu día actual termina: se cierran las posiciones y se guarda en el diario.</p>}

        <footer className="nd-foot">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button id="nd-start-btn" className="btn primary" onClick={begin}>
            {mode === 'ny' ? (ny.open ? 'Ir al mercado de ahora' : 'Elegir "Mercado ahora"') : 'Empezar el día'}
          </button>
        </footer>

        {replayable.length > 0 && (
          <section className="nd-replay">
            <h3 className="sub">Repetir un día (el mismo mercado)</h3>
            <ul>
              {replayable.map((r) => (
                <li key={r.id}>
                  <span>
                    <b>{r.label}</b>
                    <span className="t-muted small"> · {r.detail}</span>
                  </span>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      c.replayDay(r.day);
                      onClose();
                    }}
                  >
                    Repetir
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
