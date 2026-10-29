// Listas virtualizadas: qué filas se dibujan según el desplazamiento, el alto de la ventana y el margen.
import { describe, expect, it } from 'vitest';
import { virtualRange } from '../src/client/lib/virtual';

describe('rango de filas virtualizadas', () => {
  it('arriba de todo dibuja las primeras filas que entran más el margen de abajo', () => {
    const r = virtualRange(0, 200, 20, 1000, 5);
    expect(r.start).toBe(0);
    // 10 filas visibles + 1 por el redondeo + 5 de margen.
    expect(r.end).toBe(15);
    expect(r.top).toBe(0);
    expect(r.bottom).toBe((1000 - 15) * 20);
  });

  it('en el medio deja espaciadores a ambos lados del mismo alto que las filas que faltan', () => {
    const r = virtualRange(1000, 200, 20, 1000, 5);
    expect(r.start).toBe(45);
    expect(r.end).toBe(65);
    expect(r.top).toBe(45 * 20);
    expect(r.bottom).toBe((1000 - 65) * 20);
    // Lo dibujado más los espaciadores mide lo mismo que la lista completa.
    expect(r.top + (r.end - r.start) * 20 + r.bottom).toBe(1000 * 20);
  });

  it('al final no se pasa de la cantidad de filas', () => {
    const r = virtualRange(19_800, 200, 20, 1000, 5);
    expect(r.end).toBe(1000);
    expect(r.start).toBe(985);
    expect(r.bottom).toBe(0);
  });

  it('descuenta lo que hay arriba de la lista (encabezado u otros paneles en la página)', () => {
    // La lista empieza 300 px más abajo del borde: con 100 px de scroll todavía se ve desde la primera fila.
    const r = virtualRange(100, 400, 20, 50, 2);
    expect(r.start).toBe(3);
    expect(r.end).toBe(27);
    const r2 = virtualRange(100, 400, 20, 50, 2, 300);
    expect(r2.start).toBe(0);
    expect(r2.end).toBe(12);
  });

  it('listas cortas o vacías se dibujan enteras, y sin alto de fila no se dibuja nada', () => {
    expect(virtualRange(0, 500, 20, 8, 3)).toEqual({ start: 0, end: 8, top: 0, bottom: 0 });
    expect(virtualRange(0, 500, 20, 0, 3)).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
    expect(virtualRange(0, 500, 0, 10, 3)).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
  });

  it('con la lista desplazada por completo fuera de la vista (más arriba) no dibuja filas de más', () => {
    const r = virtualRange(5000, 300, 20, 100, 4);
    expect(r.start).toBe(100);
    expect(r.end).toBe(100);
    expect(r.top).toBe(2000);
    expect(r.bottom).toBe(0);
  });
});
