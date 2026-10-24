// Ticket de órdenes de práctica para la acción elegida: compra/venta a mercado, límite o stop, con
// stop y objetivo (OCO), tamaño por riesgo y el estado de la posición.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Quote, SymbolDetail } from '../../engine/types';
import { fmtMoney } from '../../trading/broker';
import { SETUPS, type OrderType } from '../../trading/types';
import { fmtPct, fmtPrice } from '../lib/format';
import { load, save } from '../lib/storage';
import type { TrainingController } from '../training';

interface Props {
  c: TrainingController;
  detail: SymbolDetail | null;
  quote: Quote | null;
}

const num = (s: string) => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

/** Un tick debajo del mínimo de la vela de 1 minuto anterior y la actual, entre 1 % y 10 % de la entrada. */
function pullbackStop(detail: SymbolDetail, entry: number): number {
  const tick = entry >= 1 ? 0.01 : 0.0001;
  const recent = detail.bars.slice(-2);
  const low = recent.length ? Math.min(...recent.map((b) => b.l)) - tick : entry * 0.97;
  return Math.min(entry * 0.99, Math.max(entry * 0.9, low));
}

export function Ticket({ c, detail, quote }: Props) {
  const sym = detail?.sym ?? null;
  const settings = c.state.settings;
  const [type, setType] = useState<OrderType>('market');
  const [shares, setShares] = useState(String(settings.defaultShares));
  const [price, setPrice] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [setup, setSetup] = useState<string>(() => load('ticket-setup', 'Bull flag'));
  const [useBracket, setUseBracket] = useState<boolean>(() => load('ticket-bracket', true));
  const pos = sym ? c.broker?.position(sym) : undefined;
  const working = sym ? (c.broker?.orders(sym) ?? []) : [];
  const flag = detail?.setup.flag;

  // Símbolo cuyos precios editó el usuario: ahí no se pisan con la sugerencia automática.
  const [editedSym, setEditedSym] = useState<string | null>(null);
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setEditedSym(sym);
  };

  // Precio, stop y objetivo sugeridos: los del bull flag armado o, si no hay, el mínimo de la vela
  // anterior (el "low of the pullback") con objetivo a 2R. Se renuevan con cada vela nueva hasta que
  // el usuario los cambia a mano.
  const suggest = () => {
    if (!detail) return;
    const entry = flag ? flag.entry : detail.row.ask || detail.row.price;
    const st = flag ? flag.stop : pullbackStop(detail, entry);
    setPrice(fmtPrice(entry));
    setStop(fmtPrice(st));
    setTarget(fmtPrice(entry + 2 * Math.max(0.01, entry - st)));
  };
  const barKey = detail?.bars[detail.bars.length - 1]?.t;
  const hasPos = !!pos;
  useEffect(() => {
    if (editedSym !== sym && !hasPos) suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, flag?.entry, barKey, hasPos]);
  // Con una posición abierta, los campos muestran su stop y objetivo reales (para moverlos con "Aplicar").
  useEffect(() => {
    if (pos?.stop !== undefined) setStop(fmtPrice(pos.stop));
    if (pos?.target !== undefined) setTarget(fmtPrice(pos.target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, pos?.stop, pos?.target]);

  // Atajo B: compra con lo que muestra el ticket (acciones, tipo, stop y objetivo).
  const buyRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'b') return;
      e.preventDefault();
      buyRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  buyRef.current = () => {};

  const bp = c.broker ? c.broker.buyingPower(c.marks) : 0;
  const entry = type === 'market' ? (quote?.ask ?? 0) : (num(price) ?? 0);
  const stopV = useBracket ? num(stop) : undefined;
  const targetV = useBracket ? num(target) : undefined;
  const qty = Math.floor(Number(shares) || 0);
  const riskPerShare = stopV && entry > stopV ? entry - stopV : 0;
  const plan = useMemo(
    () => ({
      risk: riskPerShare * qty,
      reward: targetV && entry ? (targetV - entry) * qty : 0,
      cost: entry * qty,
    }),
    [riskPerShare, qty, targetV, entry],
  );

  if (!c.active || !c.broker) {
    return (
      <div className="ticket ended">
        <p>{c.lastEnded ? 'Terminaste el día. Revisá el resultado en el diario o empezá otro.' : 'Preparando el día de práctica…'}</p>
        {c.lastEnded && (
          <button className="btn primary" onClick={() => c.newDay()}>
            Empezar otro día
          </button>
        )}
      </div>
    );
  }
  if (!sym || !detail) return <div className="ticket ended">Elegí una acción para operarla.</div>;

  // Lo máximo que se puede comprar (con un margen para el deslizamiento) y si la orden lo supera.
  const maxShares = entry > 0 ? Math.max(0, Math.floor((bp * 0.995) / entry)) : 0;
  const short = qty > 0 && entry > 0 && plan.cost > bp;

  const sizeBy = (k: 'max' | 'risk' | number) => {
    if (typeof k === 'number') return setShares(String(k));
    if (k === 'max') return setShares(String(maxShares));
    if (riskPerShare > 0) setShares(String(Math.max(1, Math.floor(settings.defaultRisk / riskPerShare))));
    else c.notify('Para calcular el tamaño por riesgo poné un stop debajo de la entrada.', 'error');
  };

  const buy = () => {
    save('ticket-setup', setup);
    c.place({ sym, side: 'buy', type, shares: qty, price: type === 'market' ? undefined : num(price), stop: stopV, target: targetV, setup });
  };
  if (qty > 0) buyRef.current = buy;
  const sellLimit = () => c.place({ sym, side: 'sell', type: type === 'stop' ? 'stop' : 'limit', shares: pos ? Math.min(qty, pos.shares) : qty, price: num(price) });
  const un = c.unrealized(sym);
  const spread = quote ? quote.ask - quote.bid : 0;
  const halted = !!quote?.halted;

  return (
    <div className="ticket">
      <div className="ticket-quote mono">
        <span title="Mejor precio de compra en el mercado: a este precio vendés a mercado">
          Bid <b className="t-up">{quote ? fmtPrice(quote.bid) : '—'}</b>
        </span>
        <span title="Mejor precio de venta en el mercado: a este precio comprás a mercado">
          Ask <b className="t-down">{quote ? fmtPrice(quote.ask) : '—'}</b>
        </span>
        <span className="t-muted">spread {quote ? (spread >= 0.995 ? fmtPrice(spread) : `${Math.round(spread * 100)}¢`) : '—'}</span>
        <span className="ticket-bp" title="Poder de compra">
          PC {fmtMoney(bp)}
        </span>
      </div>
      {halted && <p className="ticket-halt">En halt: las órdenes a mercado no se pueden ejecutar hasta que reanude.</p>}

      <div className="ticket-row">
        <div className="seg" role="group" aria-label="Tipo de orden">
          {(
            [
              ['market', 'Mercado'],
              ['limit', 'Límite'],
              ['stop', 'Stop'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} className={type === t ? 'is-active' : ''} onClick={() => setType(t)}>
              {label}
            </button>
          ))}
        </div>
        <label className="mini-field">
          Acciones
          <input id="ticket-shares" type="number" inputMode="numeric" min={1} step={1} value={shares} onChange={(e) => setShares(e.target.value)} />
        </label>
        {type !== 'market' && (
          <label className="mini-field">
            Precio
            <input id="ticket-price" type="number" inputMode="decimal" step="0.01" value={price} onChange={edit(setPrice)} />
          </label>
        )}
      </div>

      <div className="ticket-row">
        <div className="quick">
          {[100, 250, 500, 1000].map((n) => (
            <button key={n} className="chip" onClick={() => sizeBy(n)}>
              {n}
            </button>
          ))}
          <button className="chip" onClick={() => sizeBy('max')} title="Todo el poder de compra">
            Máx
          </button>
          <button className="chip" onClick={() => sizeBy('risk')} title={`Arriesgar ${fmtMoney(settings.defaultRisk)} hasta el stop`}>
            Riesgo {fmtMoney(settings.defaultRisk)}
          </button>
        </div>
      </div>

      <div className="ticket-row">
        <label className="check-inline">
          <input id="ticket-bracket" type="checkbox" checked={useBracket} onChange={(e) => (setUseBracket(e.target.checked), save('ticket-bracket', e.target.checked))} />
          Stop y objetivo
        </label>
        {useBracket && (
          <>
            <label className="mini-field">
              Stop
              <input id="ticket-stop" type="number" inputMode="decimal" step="0.01" value={stop} onChange={edit(setStop)} />
            </label>
            <label className="mini-field">
              Objetivo
              <input id="ticket-target" type="number" inputMode="decimal" step="0.01" value={target} onChange={edit(setTarget)} />
            </label>
            <button className="chip" onClick={() => (setEditedSym(null), suggest())} title="Volver a la sugerencia: stop en el mínimo de la vela anterior y objetivo a 2R; se actualiza con cada vela nueva">
              Sugerir
            </button>
          </>
        )}
        <label className="mini-field grow">
          Setup
          <select id="ticket-setup" value={setup} onChange={(e) => setSetup(e.target.value)}>
            {SETUPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="ticket-plan mono">
        Costo <span className={short ? 't-down' : ''}>{fmtMoney(plan.cost)}</span>
        {short && <span className="t-down"> · te alcanza para {maxShares}</span>}
        {plan.risk > 0 && (
          <>
            {' · '}riesgo <span className="t-down">{fmtMoney(plan.risk)}</span>
          </>
        )}
        {stopV !== undefined && entry > 0 && stopV >= entry && <span className="t-down"> · el stop quedó arriba del precio: tocá Sugerir</span>}
        {plan.reward > 0 && plan.risk > 0 && (
          <>
            {' · '}objetivo <span className="t-up">{(plan.reward / plan.risk).toFixed(1)}R</span>
          </>
        )}
      </p>

      <div className="ticket-actions">
        <button className="btn buy" onClick={buy} disabled={qty <= 0}>
          Comprar {qty > 0 ? qty : ''}
        </button>
        {pos ? (
          <>
            <button className="btn sell" onClick={() => c.sell(sym, 0.5)}>
              Vender ½
            </button>
            <button className="btn sell" onClick={() => c.sell(sym, 1)}>
              Vender todo
            </button>
            {type !== 'market' && (
              <button className="btn ghost" onClick={sellLimit}>
                Venta {type === 'stop' ? 'stop' : 'límite'}
              </button>
            )}
          </>
        ) : (
          <span className="t-muted ticket-hint">Atajos: B compra con este ticket · S vende todo · H vende la mitad · Esc cancela órdenes</span>
        )}
      </div>

      {pos && (
        <div className="ticket-pos">
          <div className="mono">
            <b>{pos.shares}</b> acc. a <b>{fmtPrice(pos.avgCost)}</b>
            {un && (
              <span className={un.pnl >= 0 ? 't-up' : 't-down'}>
                {' '}
                {un.pnl >= 0 ? '+' : ''}
                {fmtMoney(un.pnl)} ({fmtPct(un.pct)})
              </span>
            )}
            {pos.initialStop && un && (
              <span className="t-muted"> · {(un.pnl / ((pos.avgCost - pos.initialStop) * pos.shares || 1)).toFixed(1)}R</span>
            )}
          </div>
          <div className="mono t-muted">
            stop {pos.stop ? fmtPrice(pos.stop) : '—'} · objetivo {pos.target ? fmtPrice(pos.target) : '—'}
          </div>
          <div className="ticket-pos-actions">
            <button className="chip" onClick={() => c.setBracket(sym, pos.avgCost, pos.target)} title="Mover el stop al precio de entrada">
              Stop a break even
            </button>
            {useBracket && (
              <button className="chip" onClick={() => c.setBracket(sym, num(stop), num(target))}>
                Aplicar stop/objetivo
              </button>
            )}
          </div>
        </div>
      )}

      {working.length > 0 && (
        <ul className="ticket-orders">
          {working.map((o) => (
            <li key={o.id} className="mono">
              <span className={o.side === 'buy' ? 't-up' : 't-down'}>{o.side === 'buy' ? 'Compra' : 'Venta'}</span> {o.type === 'limit' ? 'límite' : 'stop'}
              {o.role === 'stop' ? ' (stop)' : o.role === 'target' ? ' (objetivo)' : ''} {o.shares} a {fmtPrice(o.price ?? 0)}
              <button className="icon-btn tiny" onClick={() => c.cancel(o.id)} aria-label="Cancelar orden">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
