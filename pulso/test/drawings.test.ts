// Líneas dibujadas en el gráfico: alta, baja, alerta que suena una sola vez y símbolos a seguir.
import { describe, expect, it } from 'vitest';
import { addDrawing, clearDrawings, crossAlerts, drawingsOf, removeDrawing, symbolsWithAlerts, toggleAlert } from '../src/client/lib/drawings';

describe('líneas del gráfico', () => {
  it('se agregan, se borran y la alerta se dispara una sola vez al cruzar el precio', () => {
    clearDrawings('RUNR');
    const h = addDrawing('RUNR', { kind: 'h', price: 5.2, alert: true });
    addDrawing('RUNR', { kind: 'h', price: 4.0 });
    addDrawing('RUNR', { kind: 't', a: { t: 100, price: 4.5 }, b: { t: 200, price: 5.0 } });
    expect(drawingsOf('RUNR')).toHaveLength(3);
    expect(symbolsWithAlerts()).toContain('RUNR');
    // Sin cruzar no pasa nada; la línea sin alerta tampoco suena.
    expect(crossAlerts('RUNR', 5.0, 5.1, 1)).toEqual([]);
    expect(crossAlerts('RUNR', 4.1, 3.9, 1)).toEqual([]);
    // Cruza hacia arriba: suena una vez y queda disparada.
    expect(crossAlerts('RUNR', 5.1, 5.3, 1000).map((l) => l.id)).toEqual([h.id]);
    expect(crossAlerts('RUNR', 5.3, 5.1, 1001)).toEqual([]);
    expect(symbolsWithAlerts()).not.toContain('RUNR');
    // Rearmarla con el toggle (dos veces) la deja lista de nuevo; tocar justo el precio también cuenta.
    toggleAlert('RUNR', h.id);
    toggleAlert('RUNR', h.id);
    expect(crossAlerts('RUNR', 5.0, 5.2, 2000)).toHaveLength(1);
    removeDrawing('RUNR', h.id);
    expect(drawingsOf('RUNR').map((d) => d.kind)).toEqual(['h', 't']);
    clearDrawings('RUNR');
    expect(drawingsOf('RUNR')).toEqual([]);
  });
});
