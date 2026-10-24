// Ajustes de la cuenta de práctica, como el panel de ajustes del simulador de Warrior Trading:
// cuenta (tipo, saldo, apalancamiento, reglas), órdenes (tamaño, vigencia, latencia, comisiones) y
// atajos de teclado configurables (con botón rápido en el ticket).
import { useEffect, useState } from 'react';
import { fmtMoney } from '../../trading/broker';
import { DEFAULT_HOTKEYS, type Hotkey, type HotkeyAction, type Tif, type TradingSettings } from '../../trading/types';
import { playOrder } from '../lib/audio';
import { fromEvent, hotkeyLabel, reserved } from '../lib/hotkeys';
import type { TrainingController } from '../training';
import { IconClose } from './Icons';

type Section = 'cuenta' | 'ordenes' | 'atajos';

const START_OPTIONS: Array<[number, string]> = [
  [7 * 60, '7:00 (pre-market temprano)'],
  [9 * 60, '9:00 (pre-market)'],
  [9 * 60 + 25, '9:25 (antes de la apertura)'],
  [9 * 60 + 45, '9:45 (ya abierto)'],
];

const fmtOffset = (o: number) => (o === 0 ? '' : ` ${o > 0 ? '+' : '−'} ${Math.abs(o).toFixed(2).replace('.', ',')}`);
const REF_LABEL = { ask: 'Ask', bid: 'Bid', last: 'Último' } as const;

/** Nombre del atajo a partir de lo que hace (se actualiza al editarlo). */
export function describeAction(a: HotkeyAction): string {
  if (a.kind === 'cancel') return 'Cancelar las órdenes de la acción';
  if (a.kind === 'breakeven') return 'Mover el stop al precio de entrada';
  if (a.kind === 'buy') {
    const qty = a.shares === 'ticket' ? 'las acciones del ticket' : a.shares === 'risk' ? 'por riesgo (hasta el stop)' : String(a.shares);
    return `Comprar ${qty} a ${REF_LABEL[a.ref]}${fmtOffset(a.offset)}`;
  }
  const part = a.fraction >= 1 ? 'toda la posición' : a.fraction === 0.5 ? '½ de la posición' : a.fraction === 0.25 ? '¼ de la posición' : `${Math.round(a.fraction * 100)}% de la posición`;
  return `Vender ${part} a ${REF_LABEL[a.ref]}${fmtOffset(a.offset)}`;
}

function KeyRecorder({ hk, onChange }: { hk: Hotkey; onChange: (k: Pick<Hotkey, 'code' | 'shift' | 'ctrl' | 'alt'>) => void }) {
  const [rec, setRec] = useState(false);
  const [warn, setWarn] = useState('');
  return (
    <span className="key-rec">
      <button
        type="button"
        className={`key-btn ${rec ? 'is-rec' : ''}`}
        onClick={() => setRec(true)}
        onBlur={() => setRec(false)}
        onKeyDown={(e) => {
          if (!rec) return;
          e.preventDefault();
          e.stopPropagation();
          const k = fromEvent(e);
          if (!k) return;
          if (reserved(k)) {
            setWarn('Esa combinación la usa el navegador: elegí otra.');
            return;
          }
          setWarn('');
          onChange(k);
          setRec(false);
        }}
        aria-label={`Tecla de "${hk.label}": ${hotkeyLabel(hk)}. Tocá y apretá la combinación nueva.`}
      >
        {rec ? 'Apretá la combinación…' : hotkeyLabel(hk)}
      </button>
      {warn && <span className="t-down small">{warn}</span>}
    </span>
  );
}

function HotkeyRow({ hk, dup, onChange, onRemove }: { hk: Hotkey; dup: boolean; onChange: (h: Hotkey) => void; onRemove: () => void }) {
  const a = hk.action;
  const setAction = (patch: Partial<HotkeyAction>) => {
    const action = { ...a, ...patch } as HotkeyAction;
    onChange({ ...hk, action, label: describeAction(action) });
  };
  return (
    <tr>
      <td>
        <div className="hk-name">{hk.label}</div>
        {a.kind === 'buy' && (
          <div className="hk-params">
            <select value={typeof a.shares === 'number' ? 'n' : a.shares} onChange={(e) => setAction({ shares: e.target.value === 'n' ? 100 : (e.target.value as 'ticket' | 'risk') })} aria-label="Cantidad">
              <option value="ticket">Acciones del ticket</option>
              <option value="risk">Por riesgo</option>
              <option value="n">Cantidad fija</option>
            </select>
            {typeof a.shares === 'number' && <input type="number" min={1} step={100} value={a.shares} onChange={(e) => setAction({ shares: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Acciones" />}
            <select value={a.ref} onChange={(e) => setAction({ ref: e.target.value as 'ask' | 'bid' | 'last' })} aria-label="Precio de referencia">
              <option value="ask">Ask</option>
              <option value="bid">Bid</option>
              <option value="last">Último</option>
            </select>
            <input type="number" step={0.01} value={a.offset} onChange={(e) => setAction({ offset: Math.round((Number(e.target.value) || 0) * 100) / 100 })} aria-label="Desplazamiento en US$" />
          </div>
        )}
        {a.kind === 'sell' && (
          <div className="hk-params">
            <select value={String(a.fraction)} onChange={(e) => setAction({ fraction: Number(e.target.value) })} aria-label="Parte de la posición">
              <option value="1">Toda la posición</option>
              <option value="0.5">½</option>
              <option value="0.25">¼</option>
              <option value="0.75">¾</option>
            </select>
            <select value={a.ref} onChange={(e) => setAction({ ref: e.target.value as 'ask' | 'bid' | 'last' })} aria-label="Precio de referencia">
              <option value="bid">Bid</option>
              <option value="ask">Ask</option>
            </select>
            <input type="number" step={0.01} value={a.offset} onChange={(e) => setAction({ offset: Math.round((Number(e.target.value) || 0) * 100) / 100 })} aria-label="Desplazamiento en US$" />
          </div>
        )}
      </td>
      <td>
        <KeyRecorder hk={hk} onChange={(k) => onChange({ ...hk, ...k })} />
        {dup && <div className="t-down small">Repetida</div>}
      </td>
      <td>
        <label className="switch">
          <input type="checkbox" checked={hk.enabled} onChange={(e) => onChange({ ...hk, enabled: e.target.checked })} aria-label="Activado" />
          <span />
        </label>
      </td>
      <td>
        <label className="switch">
          <input type="checkbox" checked={hk.button} onChange={(e) => onChange({ ...hk, button: e.target.checked })} aria-label="Botón rápido en el ticket" />
          <span />
        </label>
      </td>
      <td>
        <button type="button" className="icon-btn tiny" onClick={onRemove} aria-label="Borrar atajo" title="Borrar">
          ×
        </button>
      </td>
    </tr>
  );
}

export function PracticeSettings({ c, onClose, initial = 'cuenta' }: { c: TrainingController; onClose: () => void; initial?: Section }) {
  const [section, setSection] = useState<Section>(initial);
  const [s, setS] = useState<TradingSettings>(() => structuredClone(c.state.settings));
  const [confirm, setConfirm] = useState<'reset' | 'wipe' | null>(null);
  const [dirty, setDirty] = useState(false);
  const sum = c.summary();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const set = (patch: Partial<TradingSettings>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const save = () => {
    c.updateSettings(s);
    setDirty(false);
    c.notify('Ajustes de práctica guardados.', 'ok');
  };
  const keyOf = (h: Hotkey) => `${h.ctrl}${h.alt}${h.shift}${h.code}`;
  const dupKeys = new Set(s.hotkeys.filter((h, i) => h.enabled && s.hotkeys.findIndex((x) => x.enabled && keyOf(x) === keyOf(h)) !== i).map(keyOf));
  const field = (k: keyof TradingSettings, label: string, stepv = '1', hint?: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input id={`trade-set-${k}`} type="number" inputMode="decimal" step={stepv} min={0} value={String(s[k])} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<TradingSettings>)} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
  const addHotkey = (kind: HotkeyAction['kind']) => {
    const action: HotkeyAction =
      kind === 'buy' ? { kind, shares: 100, ref: 'ask', offset: 0.05 } : kind === 'sell' ? { kind, fraction: 1, ref: 'bid', offset: -0.05 } : { kind };
    set({ hotkeys: [...s.hotkeys, { id: `hk${Date.now().toString(36)}`, label: describeAction(action), code: 'Digit0', shift: true, ctrl: false, alt: false, enabled: true, button: false, action }] });
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="ps-title" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Secciones">
          {(
            [
              ['cuenta', 'Cuenta'],
              ['ordenes', 'Órdenes y costos'],
              ['atajos', 'Atajos de teclado'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={section === id ? 'is-active' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <header className="modal-head">
            <h2 id="ps-title">{section === 'cuenta' ? 'Cuenta de práctica' : section === 'ordenes' ? 'Órdenes y costos' : 'Atajos de teclado'}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <IconClose />
            </button>
          </header>

          {section === 'cuenta' && (
            <div className="settings-grid">
              <section className="card">
                <h3>Ajustar o reiniciar la cuenta</h3>
                <label className="field">
                  <span className="field-label">Tipo de cuenta</span>
                  <select id="trade-set-account" value={s.account} onChange={(e) => set({ account: e.target.value as 'cash' | 'margin' })}>
                    <option value="cash">Cash: sin regla PDT, el dinero de las ventas se libera al día siguiente (T+1)</option>
                    <option value="margin">Margen: apalancamiento, con la regla PDT por debajo de US$ 25.000</option>
                  </select>
                </label>
                {field('startingBalance', 'Efectivo inicial (US$)', '100', 'Se aplica al reiniciar la cuenta')}
                {s.account === 'margin' ? (
                  <>
                    <label className="field">
                      <span className="field-label">Apalancamiento</span>
                      <select id="trade-set-leverage" value={s.leverage} onChange={(e) => set({ leverage: Number(e.target.value) })}>
                        <option value={2}>2x (Reg T)</option>
                        <option value={4}>4x intradía (solo con US$ 25.000 o más)</option>
                      </select>
                    </label>
                    <label className="check-inline">
                      <input type="checkbox" checked={s.pdt} onChange={(e) => set({ pdt: e.target.checked })} />
                      Regla PDT: máximo 3 day trades cada 5 días con menos de US$ 25.000
                    </label>
                  </>
                ) : (
                  <label className="check-inline">
                    <input type="checkbox" checked={s.settlement} onChange={(e) => set({ settlement: e.target.checked })} />
                    Liquidación T+1: lo que vendés hoy se puede volver a usar mañana
                  </label>
                )}
                {field('maxDailyLoss', 'Pérdida máxima del día (US$)', '10', '0 = sin límite. Al llegar, se bloquean las compras (la regla de Ross: cortar el día)')}
                <div className="row-end">
                  {confirm === 'reset' ? (
                    <span className="confirm">
                      ¿Reiniciar con {fmtMoney(s.startingBalance)}? Se conserva el historial.
                      <button className="btn danger" onClick={() => (c.updateSettings(s), c.resetAccount(false), setConfirm(null), setDirty(false))}>
                        Sí, reiniciar
                      </button>
                      <button className="btn" onClick={() => setConfirm(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button className="btn" onClick={() => setConfirm('reset')}>
                      Reiniciar la cuenta
                    </button>
                  )}
                </div>
                <div className="row-end">
                  {confirm === 'wipe' ? (
                    <span className="confirm">
                      Se borran todos los días, trades y métricas.
                      <button className="btn danger" onClick={() => (c.updateSettings(s), c.resetAccount(true), setConfirm(null), setDirty(false))}>
                        Borrar todo
                      </button>
                      <button className="btn" onClick={() => setConfirm(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button className="btn danger" onClick={() => setConfirm('wipe')}>
                      Borrar historial y métricas
                    </button>
                  )}
                </div>
              </section>
              <section className="card">
                <h3>Valores actuales</h3>
                <dl className="av-list">
                  <div>
                    <dt>Efectivo disponible</dt>
                    <dd className="t-up">{fmtMoney(sum.cash - sum.unsettled)}</dd>
                  </div>
                  <div>
                    <dt>Sin liquidar (T+1)</dt>
                    <dd className="t-warn">{fmtMoney(sum.unsettled)}</dd>
                  </div>
                  <div>
                    <dt>Valor de posiciones</dt>
                    <dd>{fmtMoney(sum.positionValue)}</dd>
                  </div>
                  <div>
                    <dt>Margen usado</dt>
                    <dd className="t-warn">{fmtMoney(sum.marginBorrowed)}</dd>
                  </div>
                </dl>
                <div className="av-equity">
                  <span>Equity</span>
                  <b>{fmtMoney(sum.equity)}</b>
                </div>
                <dl className="av-list">
                  <div>
                    <dt>Poder de compra usado</dt>
                    <dd className="t-warn">{fmtMoney(sum.bpUsed)}</dd>
                  </div>
                  <div className="av-bp">
                    <dt>Poder de compra disponible</dt>
                    <dd className="t-bp">{fmtMoney(sum.buyingPower)}</dd>
                  </div>
                  {s.account === 'margin' && (
                    <div>
                      <dt>Day trades (últimos 5 días)</dt>
                      <dd>{sum.dayTrades}</dd>
                    </div>
                  )}
                </dl>
              </section>
            </div>
          )}

          {section === 'ordenes' && (
            <div className="settings-grid">
              <section className="card">
                <h3>Ticket</h3>
                {field('defaultShares', 'Acciones por defecto', '100')}
                {field('defaultRisk', 'Riesgo por trade (US$)', '5', 'Para "tamaño por riesgo" y el atajo de compra por riesgo')}
                <label className="field">
                  <span className="field-label">Vigencia por defecto (TIF)</span>
                  <select id="trade-set-tif" value={s.defaultTif} onChange={(e) => set({ defaultTif: e.target.value as Tif })}>
                    <option value="DAY+">DAY+ (también pre-market y after-hours)</option>
                    <option value="DAY">DAY (solo la rueda regular)</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Hora de inicio del día simulado</span>
                  <select id="trade-set-start" value={s.startMinutes} onChange={(e) => set({ startMinutes: Number(e.target.value) })}>
                    {START_OPTIONS.map(([m, label]) => (
                      <option key={m} value={m}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <section className="card">
                <h3>Salidas y sonidos</h3>
                <label className="check-inline">
                  <input id="trade-set-auto" type="checkbox" checked={s.autoBracket} onChange={(e) => set({ autoBracket: e.target.checked })} />
                  Stop y objetivo automáticos al comprar (OCO)
                </label>
                <p className="field-hint">
                  Apagado: la compra sale sola y las salidas las hacés vos, con los atajos o los botones. El stop y el objetivo del ticket quedan como plan: sirven para el tamaño por riesgo y la R, y se ven punteados en el gráfico. Prendido: se colocan como órdenes que se cancelan entre sí.
                </p>
                <label className="check-inline">
                  <input id="trade-set-sounds" type="checkbox" checked={s.orderSounds} onChange={(e) => set({ orderSounds: e.target.checked })} />
                  Sonidos de las órdenes
                </label>
                <p className="field-hint">
                  Uno distinto cuando se ejecuta una compra o una venta, al cerrar un trade con ganancia o con pérdida, en una ejecución parcial, cuando la orden queda en espera, al cancelarla y si se rechaza.{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      const order = ['buy', 'sell', 'win', 'loss', 'partial', 'placed', 'canceled', 'rejected'] as const;
                      order.forEach((k, i) => setTimeout(() => playOrder(k), i * 650));
                    }}
                  >
                    Escucharlos
                  </button>
                </p>
              </section>
              <section className="card">
                <h3>Ejecución y costos</h3>
                {field('latencyMs', 'Latencia de envío (ms)', '10', 'Lo que tarda la orden en llegar al mercado (100–300 ms es normal)')}
                {field('commissionPerShare', 'Comisión por acción (US$)', '0.001', 'Ej.: 0,005 como en un bróker de day trading; 0 = sin comisión')}
                {field('minCommission', 'Comisión mínima por orden (US$)', '0.1')}
                <label className="check-inline">
                  <input type="checkbox" checked={s.regFees} onChange={(e) => set({ regFees: e.target.checked })} />
                  Tasas regulatorias en las ventas (SEC US$ 20,60 por millón y FINRA TAF US$ 0,000195 por acción)
                </label>
              </section>
            </div>
          )}

          {section === 'atajos' && (
            <div className="hk-wrap">
              <p className="t-muted small">
                Tocá una tecla y apretá la combinación nueva. Los atajos funcionan con la acción elegida y no actúan mientras escribís en un campo. Con "Botón rápido" aparecen en el ticket.
              </p>
              <table className="grid-table hk-table">
                <thead>
                  <tr>
                    <th>Nombre / qué hace</th>
                    <th>Tecla</th>
                    <th>Activado</th>
                    <th>Botón rápido</th>
                    <th aria-label="Borrar" />
                  </tr>
                </thead>
                <tbody>
                  {s.hotkeys.map((h, i) => (
                    <HotkeyRow
                      key={h.id}
                      hk={h}
                      dup={dupKeys.has(keyOf(h))}
                      onChange={(next) => set({ hotkeys: s.hotkeys.map((x, j) => (j === i ? next : x)) })}
                      onRemove={() => set({ hotkeys: s.hotkeys.filter((_, j) => j !== i) })}
                    />
                  ))}
                </tbody>
              </table>
              <div className="row-end">
                <button className="btn" onClick={() => addHotkey('buy')}>
                  + Compra
                </button>
                <button className="btn" onClick={() => addHotkey('sell')}>
                  + Venta
                </button>
                <button className="btn" onClick={() => set({ hotkeys: structuredClone(DEFAULT_HOTKEYS) })}>
                  Volver a los de fábrica
                </button>
              </div>
            </div>
          )}

          <footer className="settings-foot">
            <span className="t-muted small">{dirty ? 'Los cambios se aplican al guardar.' : ' '}</span>
            <button className="btn primary" onClick={save} disabled={!dirty || dupKeys.size > 0}>
              Guardar cambios
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
