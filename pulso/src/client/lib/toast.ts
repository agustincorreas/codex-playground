// Avisos de la interfaz que no vienen de la cuenta de práctica (por ejemplo, "Línea borrada ·
// Deshacer"): un almacén chiquito; la página los muestra junto con los avisos de la cuenta.
import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  /** Botón dentro del aviso (deshacer, ver...). Al tocarlo, el aviso se cierra. */
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const cb of listeners) cb();
}

export function pushToast(text: string, tone: Toast['tone'] = 'info', opts: { action?: Toast['action']; ms?: number } = {}): number {
  const t: Toast = { id: ++seq, text, tone, action: opts.action };
  toasts = [...toasts.slice(-3), t];
  emit();
  timers.set(
    t.id,
    setTimeout(() => dismissToast(t.id), opts.ms ?? 4000),
  );
  return t.id;
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function readToasts(): Toast[] {
  return toasts;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribeToasts, readToasts, readToasts);
}
