// Líneas dibujadas sobre el gráfico, por símbolo: horizontales (con o sin alerta de precio) y de
// tendencia (dos puntos). Se guardan en este navegador y las comparten los dos gráficos.
import { useEffect, useState } from 'react';
import { load, save } from './storage';

export interface HLine {
  id: string;
  kind: 'h';
  price: number;
  /** Con alerta: avisa (una vez) cuando el precio la cruza. */
  alert?: boolean;
  /** Cuándo se disparó la alerta (no vuelve a sonar). */
  fired?: number;
}

export interface TLine {
  id: string;
  kind: 't';
  /** Puntos en el tiempo del gráfico (segundos, hora de Nueva York) y precio. */
  a: { t: number; price: number };
  b: { t: number; price: number };
}

export type Drawing = HLine | TLine;

const INDEX = 'drawings-syms';
const cache = new Map<string, Drawing[]>();
/** Símbolos con líneas (en memoria y en el navegador). */
let index: Set<string> | null = null;
function symbols(): Set<string> {
  if (!index) index = new Set(load<string[]>(INDEX, []));
  return index;
}
const listeners = new Set<() => void>();

function key(sym: string): string {
  return `drawings-${sym}`;
}

export function drawingsOf(sym: string): Drawing[] {
  let list = cache.get(sym);
  if (!list) {
    list = load<Drawing[]>(key(sym), []);
    if (!Array.isArray(list)) list = [];
    cache.set(sym, list);
  }
  return list;
}

export function setDrawings(sym: string, list: Drawing[]): void {
  cache.set(sym, list);
  save(key(sym), list);
  const syms = symbols();
  if (list.length) syms.add(sym);
  else syms.delete(sym);
  save(INDEX, [...syms]);
  for (const cb of listeners) cb();
}

let seq = 0;
export function addDrawing(sym: string, d: Omit<HLine, 'id'> | Omit<TLine, 'id'>): Drawing {
  const full = { ...d, id: `${Date.now().toString(36)}${(seq++).toString(36)}` } as Drawing;
  setDrawings(sym, [...drawingsOf(sym), full]);
  return full;
}

export function removeDrawing(sym: string, id: string): void {
  setDrawings(
    sym,
    drawingsOf(sym).filter((d) => d.id !== id),
  );
}

export function clearDrawings(sym: string): void {
  setDrawings(sym, []);
}

/** Prende o apaga la alerta de una línea horizontal (al prenderla vuelve a estar armada). */
export function toggleAlert(sym: string, id: string): void {
  setDrawings(
    sym,
    drawingsOf(sym).map((d) => (d.id === id && d.kind === 'h' ? { ...d, alert: !d.alert, fired: undefined } : d)),
  );
}

/** Símbolos con alguna alerta de precio armada (para seguirlos aunque no estén en pantalla). */
export function symbolsWithAlerts(): string[] {
  return [...symbols()].filter((sym) => drawingsOf(sym).some((d) => d.kind === 'h' && d.alert && !d.fired));
}

/**
 * El precio pasó de `prev` a `cur`: devuelve las líneas con alerta que cruzó (o tocó) y las deja
 * disparadas, así suenan una sola vez.
 */
export function crossAlerts(sym: string, prev: number, cur: number, now: number): HLine[] {
  if (!(prev > 0) || !(cur > 0) || prev === cur) return [];
  const lo = Math.min(prev, cur);
  const hi = Math.max(prev, cur);
  const hit = drawingsOf(sym).filter((d): d is HLine => d.kind === 'h' && !!d.alert && !d.fired && d.price >= lo && d.price <= hi);
  if (hit.length) {
    const ids = new Set(hit.map((d) => d.id));
    setDrawings(
      sym,
      drawingsOf(sym).map((d) => (ids.has(d.id) ? { ...d, fired: now } : d)),
    );
  }
  return hit;
}

export function subscribeDrawings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Las líneas de un símbolo, con actualización cuando cambian desde cualquier gráfico. */
export function useDrawings(sym: string | undefined): Drawing[] {
  const [, bump] = useState(0);
  useEffect(() => subscribeDrawings(() => bump((n) => n + 1)), []);
  return sym ? drawingsOf(sym) : [];
}
