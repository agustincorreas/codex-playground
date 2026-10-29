// Disponibilidad para pedir prestado ("locate") de la cuenta de práctica: antes de vender en corto, el
// bróker tiene que conseguir las acciones. En las small caps eso es lo normal del día: las de float
// chico o precio bajo muchas veces no se consiguen, o cuestan un locate por acción (HTB, "hard to
// borrow"); las de float grande se prestan sin costo (ETB, "easy to borrow"). La regla es
// determinística por símbolo y día, así un mismo día de práctica repetido da el mismo resultado.

export type Shortable = 'etb' | 'htb' | 'none';

export interface Locate {
  shortable: Shortable;
  /** Costo del locate por acción (US$), cobrado al ejecutarse la venta en corto. 0 si es ETB. */
  borrowFee: number;
}

export const LOCATE_LABEL: Record<Shortable, string> = { etb: 'ETB', htb: 'HTB', none: 'No prestable' };

/** Hash chico y estable (FNV-1a de 32 bits) para que la suerte del locate dependa del símbolo y del día. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Prestables de una acción para un día: float < 5 M o precio < US$ 1 → sin acciones el 40 % de los
 * días y, el resto, HTB con locate de US$ 0,01–0,05 por acción; float 5–20 M → HTB con US$ 0,005–0,02;
 * float > 20 M → ETB sin costo. Sin dato del float se la trata como una small cap de 5–20 M.
 */
export function locateFor(sym: string, dayKey: string, ref: { float?: number; price?: number }): Locate {
  const h = hash(`${sym}|${dayKey}`);
  const roll = h % 100;
  const frac = ((h >>> 8) % 1000) / 999;
  const float = ref.float;
  const price = ref.price ?? 0;
  const fee = (lo: number, hi: number) => round4(lo + frac * (hi - lo));
  if ((float !== undefined && float < 5e6) || (price > 0 && price < 1)) {
    if (roll < 40) return { shortable: 'none', borrowFee: 0 };
    return { shortable: 'htb', borrowFee: fee(0.01, 0.05) };
  }
  if (float === undefined || float < 20e6) return { shortable: 'htb', borrowFee: fee(0.005, 0.02) };
  return { shortable: 'etb', borrowFee: 0 };
}

/** El costo por acción con los decimales justos: 0,02, 0,005, 0,0125. */
export function fmtFee(fee: number): string {
  return fee
    .toFixed(4)
    .replace(/0+$/, '')
    .replace(/\.$/, '.00')
    .replace('.', ',');
}

/** "HTB · US$ 0,02/acción", "ETB · sin costo" o "No prestable hoy". */
export function describeLocate(l: Locate): string {
  if (l.shortable === 'none') return 'No prestable hoy';
  if (l.shortable === 'etb') return 'ETB · sin costo';
  return `HTB · US$ ${fmtFee(l.borrowFee)}/acción`;
}
