// Formateadores de la interfaz, todos en un lugar y con la convención es-AR para montos y cantidades
// (punto de miles, coma decimal). Los precios de las acciones van con punto decimal y sin miles
// ("12.34", "0.8512"): es como los muestra el eje del gráfico, como los escribís en el ticket y como
// los cuenta el bróker; mezclarlos con la coma confundiría 1,25 con 125.
import { fmtPrice, fmtVolume } from '../../engine/alerts';

export { fmtPrice, fmtVolume };

/** Alias histórico de `fmtPrice` (el bróker lo llama así). */
export const fmtPx = fmtPrice;

/** Entero con punto de miles: 1.250. */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('es-AR');
}

/** Monto en dólares con miles y decimales a la argentina: $1.234,56 / −$12,00. */
export function fmtMoney(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Monto con signo explícito: +$120,50 / −$8,00 / $0,00. */
export function fmtSignedMoney(v: number, digits = 2): string {
  return `${v > 0 ? '+' : ''}${fmtMoney(v, digits)}`;
}

/** Monto abreviado para cifras grandes (capitalización): $1,2M, $850K. */
export function fmtMoneyShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const dec = (x: number, d: number) => x.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: d });
  if (v >= 1e9) return `$${dec(v / 1e9, 2)}B`;
  if (v >= 1e6) return `$${dec(v / 1e6, 1)}M`;
  if (v >= 1e3) return `$${dec(v / 1e3, 1)}K`;
  return `$${dec(v, 0)}`;
}

export function fmtPct(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return '—';
  const s = p.toFixed(Math.abs(p) >= 100 ? 0 : digits);
  return `${p > 0 ? '+' : ''}${s}%`;
}

export function fmtRvol(x: number): string {
  if (!(x > 0)) return '—';
  if (x >= 100) return `${Math.round(x)}x`;
  if (x >= 10) return `${x.toFixed(1)}x`;
  return `${x.toFixed(2)}x`;
}

export function fmtFloat(f?: number): string {
  if (!f) return '—';
  if (f >= 1e9) return `${(f / 1e9).toFixed(2)}B`;
  if (f >= 1e6) return `${(f / 1e6).toFixed(f >= 1e8 ? 0 : f >= 1e7 ? 1 : 2)}M`;
  return `${(f / 1e3).toFixed(0)}K`;
}

export function toneOf(n: number): 'up' | 'down' | 'flat' {
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Duración corta: 45s, 3m 05s, 1h 20m. */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Lee un número escrito a mano en un ajuste: "2,5" y "2.5" valen 2,5; "0,001" vale 0,001; con los dos
 * separadores, el último es el decimal ("1.500,50" → 1500,5). Vacío o ilegible → `undefined`.
 */
export function parseDecimal(raw: string): number | undefined {
  const t = raw.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!t || !/\d/.test(t)) return undefined;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let norm: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    norm = t
      .split(dec === '.' ? ',' : '.')
      .join('')
      .replace(dec, '.');
  } else norm = t.replace(',', '.');
  const v = Number(norm);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Lee un monto escrito a mano: "5000", "5.000", "25,000", "1.500,50" o "1,500.50". Con un solo
 * separador seguido de grupos de 3 cifras, es de miles; si no, es el decimal.
 */
export function parseMoney(raw: string): number | undefined {
  const t = raw.replace(/[^\d.,]/g, '');
  if (!t) return undefined;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let norm: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    norm = t
      .split(dec === '.' ? ',' : '.')
      .join('')
      .replace(dec, '.');
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(t)) norm = t.replace(/[.,]/g, '');
  else norm = t.replace(',', '.');
  const v = Number(norm);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}
