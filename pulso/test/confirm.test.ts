// Modo "pedir confirmación" y avisos con acción (deshacer).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmOrders, resetConfirmForTests, resolveConfirm, setConfirmOrders, withConfirm } from '../src/client/lib/confirm';
import { dismissToast, pushToast, readToasts } from '../src/client/lib/toast';
import { addDrawing, clearDrawings, drawingsOf, removeDrawing, restoreDrawing } from '../src/client/lib/drawings';

describe('pedir confirmación antes de enviar', () => {
  beforeEach(() => resetConfirmForTests());
  afterEach(() => resetConfirmForTests());

  it('apagado, la orden sale enseguida', () => {
    const run = vi.fn();
    withConfirm({ sym: 'ABC', side: 'buy', shares: 100, type: 'limit', price: 5.2 }, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(confirmOrders()).toBe(false);
  });

  it('prendido, espera la respuesta: Enter envía, Esc cancela', () => {
    setConfirmOrders(true);
    const run = vi.fn();
    withConfirm({ sym: 'ABC', side: 'sell', shares: 50, type: 'market' }, run);
    expect(run).not.toHaveBeenCalled();
    resolveConfirm(false);
    expect(run).not.toHaveBeenCalled();
    withConfirm({ sym: 'ABC', side: 'sell', shares: 50, type: 'market' }, run);
    resolveConfirm(true);
    expect(run).toHaveBeenCalledTimes(1);
    // Una segunda respuesta sin orden pendiente no hace nada.
    resolveConfirm(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('avisos con acción y deshacer el borrado de una línea', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('el aviso dura lo indicado y su acción lo cierra', () => {
    const run = vi.fn();
    const id = pushToast('Línea borrada', 'info', { ms: 5000, action: { label: 'Deshacer', run } });
    expect(readToasts().map((t) => t.id)).toContain(id);
    vi.advanceTimersByTime(4900);
    expect(readToasts().map((t) => t.id)).toContain(id);
    dismissToast(id);
    expect(readToasts().map((t) => t.id)).not.toContain(id);
    const id2 = pushToast('Otro', 'ok', { ms: 1000 });
    vi.advanceTimersByTime(1001);
    expect(readToasts().map((t) => t.id)).not.toContain(id2);
  });

  it('una línea borrada vuelve a su lugar, una sola vez', () => {
    clearDrawings('UNDO');
    const a = addDrawing('UNDO', { kind: 'h', price: 1 });
    const b = addDrawing('UNDO', { kind: 'h', price: 2 });
    const c = addDrawing('UNDO', { kind: 'h', price: 3 });
    const removed = removeDrawing('UNDO', b.id);
    expect(removed?.index).toBe(1);
    expect(drawingsOf('UNDO').map((d) => d.id)).toEqual([a.id, c.id]);
    restoreDrawing('UNDO', removed!.drawing, removed!.index);
    expect(drawingsOf('UNDO').map((d) => d.id)).toEqual([a.id, b.id, c.id]);
    restoreDrawing('UNDO', removed!.drawing, removed!.index);
    expect(drawingsOf('UNDO')).toHaveLength(3);
    expect(removeDrawing('UNDO', 'no-existe')).toBeUndefined();
    clearDrawings('UNDO');
  });
});
