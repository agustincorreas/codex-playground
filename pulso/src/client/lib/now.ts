// Reloj compartido de la interfaz: un solo intervalo (4 veces por segundo) que avisa a los
// componentes que muestran la hora, una cuenta regresiva o un "hace 2 min". Antes la hora vivía en
// el estado raíz de la aplicación y cada tic volvía a dibujar todos los paneles.
import { useSyncExternalStore } from 'react';

type Clock = () => number;

const TICK_MS = 250;
const listeners = new Set<() => void>();
let clock: Clock | null = null;
/** Última lectura del reloj (0 mientras no hay fuente de datos: el encabezado muestra "--:--:--"). */
let value = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  const next = clock ? clock() : 0;
  if (next === value) return;
  value = next;
  for (const l of listeners) l();
}

/** La fuente de datos manda la hora (la del mercado simulado o la del servidor); `null` la apaga. */
export function setClock(fn: Clock | null): void {
  clock = fn;
  tick();
}

/** Lectura puntual (sin suscribirse): para efectos y cálculos que no necesitan volver a dibujarse. */
export function readNow(): number {
  return clock ? clock() : value;
}

export function subscribeNow(l: () => void): () => void {
  listeners.add(l);
  if (!timer) timer = setInterval(tick, TICK_MS);
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * La hora actual, redondeada hacia abajo a `stepMs`: el componente se vuelve a dibujar solo cuando
 * cambia ese valor (con 1000, una vez por segundo; con 250, cuatro veces, para el reloj del encabezado).
 */
export function useNow(stepMs = TICK_MS): number {
  const get = () => (value && stepMs > 1 ? Math.floor(value / stepMs) * stepMs : value);
  return useSyncExternalStore(subscribeNow, get, get);
}

/** Solo para pruebas: deja el reloj como al principio. */
export function resetClockForTests(): void {
  clock = null;
  value = 0;
  listeners.clear();
  if (timer) clearInterval(timer);
  timer = undefined;
}
