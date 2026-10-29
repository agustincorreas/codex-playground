// Modo "pedir confirmación": con la preferencia activa, toda orden (ticket, barra del celular, atajos
// y botones de cerrar posición) pasa por un diálogo antes de enviarse. Las órdenes llaman a
// `withConfirm` con una vista previa y lo que hay que ejecutar; la página dibuja el diálogo.
// La primera venta en corto de la sesión pasa por el diálogo aunque el modo esté apagado: explica el
// riesgo (ilimitado, a diferencia de una compra) y el locate antes de mandarla.
import { useSyncExternalStore } from 'react';

export interface OrderPreview {
  sym: string;
  side: 'buy' | 'sell';
  shares: number;
  type: 'limit' | 'market' | 'stop';
  /** Precio límite o de disparo; a mercado, el precio estimado. */
  price?: number;
  /** El precio se calcula al enviar (atajos, cierre de posición): se muestra como aproximado. */
  approx?: boolean;
  /** Qué hace la orden con la posición: abre o agranda un corto, o lo cubre. Sin dato, compra o venta de un largo. */
  kind?: 'short' | 'cover';
  /** Costo del locate por acción de un corto HTB (se muestra antes de enviar). */
  borrowFee?: number;
  /** Es el primer corto de la sesión: el diálogo explica el riesgo antes de enviarlo. */
  shortWarning?: boolean;
}

interface Pending {
  preview: OrderPreview;
  run: () => void;
}

let enabled = false;
let pending: Pending | null = null;
/** Ya se aceptó el aviso de riesgo de los cortos en esta sesión (carga de la página). */
let shortAcknowledged = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

export function setConfirmOrders(on: boolean): void {
  enabled = on;
  if (!on && pending) {
    pending = null;
    emit();
  }
}

export function confirmOrders(): boolean {
  return enabled;
}

/**
 * Ejecuta la orden, o la deja pendiente de confirmación si el modo está activo (o si es el primer
 * corto de la sesión: ese siempre se confirma, con el aviso de riesgo).
 */
export function withConfirm(preview: OrderPreview, run: () => void): void {
  const firstShort = preview.kind === 'short' && !shortAcknowledged;
  if (!enabled && !firstShort) return run();
  pending = { preview: firstShort ? { ...preview, shortWarning: true } : preview, run };
  emit();
}

/** Respuesta del diálogo: enviar (true) o cancelar (false). */
export function resolveConfirm(ok: boolean): void {
  const p = pending;
  pending = null;
  emit();
  if (ok && p?.preview.kind === 'short') shortAcknowledged = true;
  if (ok && p) p.run();
}

function readPending(): OrderPreview | null {
  return pending?.preview ?? null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePendingOrder(): OrderPreview | null {
  return useSyncExternalStore(subscribe, readPending, readPending);
}

/** Solo para los tests. */
export function resetConfirmForTests(): void {
  enabled = false;
  pending = null;
  shortAcknowledged = false;
}
