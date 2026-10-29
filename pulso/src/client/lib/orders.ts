// Cerrar una posición desde las ventanas de posiciones: pasa por la confirmación si está activa.
import type { TrainingController } from '../training';
import { withConfirm } from './confirm';

/**
 * Cierra toda la posición como el atajo: un largo se vende a Bid − 0,05, un corto se cubre a
 * Ask + 0,05. Con la vista previa para confirmar. Sin posición no hace nada (nunca abre un corto).
 */
export function sellAll(c: TrainingController, sym: string): void {
  const p = c.broker?.position(sym);
  if (!p) return;
  const last = c.marks(sym);
  const short = p.side === 'short';
  const price = last ? (short ? last + 0.05 : Math.max(0.0001, last - 0.05)) : undefined;
  withConfirm({ sym, side: short ? 'buy' : 'sell', kind: short ? 'cover' : undefined, shares: p.shares, type: 'limit', price, approx: true }, () => c.sell(sym, 1));
}

/** Lo mismo que `sellAll` (cubre un corto): por claridad en los botones de cubrir. */
export const coverAll = sellAll;
