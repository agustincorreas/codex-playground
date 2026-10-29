// Listas largas (escáner, alertas, cinta, diario): se dibujan solo las filas que entran en la ventana,
// con un espaciador arriba y otro abajo del mismo alto que las filas que faltan. Sin dependencias.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface VirtualRange {
  /** Primera fila a dibujar y la siguiente a la última (como en `slice`). */
  start: number;
  end: number;
  /** Alto en píxeles de los espaciadores de arriba y de abajo. */
  top: number;
  bottom: number;
}

const EMPTY: VirtualRange = { start: 0, end: 0, top: 0, bottom: 0 };

/**
 * Rango de filas a dibujar (función pura). `scrollTop` y `viewport` son del área que se desplaza;
 * `offset` es a qué altura de esa área empieza la lista (por ejemplo, debajo del encabezado de la
 * tabla); `overscan` son las filas de más que se dibujan por arriba y por abajo, para que al
 * desplazarse de a poco o con Tab no aparezcan huecos.
 */
export function virtualRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan: number, offset = 0): VirtualRange {
  if (count <= 0 || rowHeight <= 0) return EMPTY;
  const rel = scrollTop - offset;
  const first = Math.floor(rel / rowHeight);
  const last = Math.ceil((rel + Math.max(0, viewport)) / rowHeight);
  const start = Math.min(count, Math.max(0, first - overscan));
  const end = Math.max(start, Math.min(count, last + overscan));
  return { start, end, top: start * rowHeight, bottom: (count - end) * rowHeight };
}

function sameRange(a: VirtualRange, b: VirtualRange): boolean {
  return a.start === b.start && a.end === b.end && a.top === b.top && a.bottom === b.bottom;
}

type Scroller = HTMLElement | Window;

interface Measure {
  scrollTop: number;
  viewport: number;
  offset: number;
}

export interface VirtualOptions {
  /** Selector del elemento que se desplaza (el panel, la hoja del diario). Si no desplaza (celular), es la página. */
  scroller?: string;
  /** Filas de más por arriba y por abajo. */
  overscan?: number;
}

/** ¿Este elemento recorta o desplaza su contenido en vertical? */
function scrolls(el: HTMLElement): boolean {
  const o = getComputedStyle(el).overflowY;
  return o === 'auto' || o === 'scroll' || o === 'hidden';
}

/**
 * Filas visibles de una lista larga. `ref` apunta al contenedor de las filas (el `tbody` o el `ol`);
 * las filas de verdad llevan `data-vrow` para medir su alto real (`rowHeight` es la estimación
 * inicial). Devuelve el rango a dibujar y `scrollToIndex` para llevar la vista a una fila.
 */
export function useVirtualRows(ref: RefObject<HTMLElement | null>, rowHeight: number, count: number, overscanOrOpts: number | VirtualOptions = 8) {
  const opts: VirtualOptions = typeof overscanOrOpts === 'number' ? { overscan: overscanOrOpts } : overscanOrOpts;
  const overscan = opts.overscan ?? 8;
  const selector = opts.scroller;
  const [range, setRange] = useState<VirtualRange>(EMPTY);
  const rowRef = useRef(rowHeight);
  const countRef = useRef(count);
  countRef.current = count;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const scrollerRef = useRef<Scroller | null>(null);

  const findScroller = useCallback((): Scroller => {
    const el = ref.current;
    if (!el) return window;
    const host = selector ? (el.closest(selector) as HTMLElement | null) : null;
    if (host && scrolls(host)) return host;
    // Sin selector: el ancestro más cercano que desplaza (una lectura de estilo por nivel, solo al armar).
    if (!selector) {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) if (scrolls(node)) return node;
    }
    return window;
  }, [ref, selector]);

  const measure = useCallback((): Measure | null => {
    const el = ref.current;
    if (!el) return null;
    const sc = scrollerRef.current ?? (scrollerRef.current = findScroller());
    const rect = el.getBoundingClientRect();
    if (sc === window) return { scrollTop: window.scrollY, viewport: window.innerHeight, offset: rect.top + window.scrollY };
    const host = sc as HTMLElement;
    return { scrollTop: host.scrollTop, viewport: host.clientHeight, offset: rect.top - host.getBoundingClientRect().top + host.scrollTop };
  }, [ref, findScroller]);

  const update = useCallback(() => {
    const m = measure();
    if (!m) return;
    const el = ref.current!;
    // El alto real de una fila dibujada manda sobre la estimación.
    const row = el.querySelector('[data-vrow]');
    if (row) {
      const h = row.getBoundingClientRect().height;
      if (h > 0 && Math.abs(h - rowRef.current) > 0.5) rowRef.current = h;
    }
    const next = virtualRange(m.scrollTop, m.viewport, rowRef.current, countRef.current, overscan, m.offset);
    if (!sameRange(next, rangeRef.current)) {
      rangeRef.current = next;
      setRange(next);
    }
  }, [measure, overscan, ref]);

  // Al armar (antes de pintar, así no hay un cuadro vacío), al desplazarse y al cambiar de tamaño. La
  // lista puede no existir mientras está vacía: se vuelve a enganchar cuando aparece.
  const empty = count === 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    scrollerRef.current = findScroller();
    update();
    const sc = scrollerRef.current;
    const target: EventTarget = sc === window ? window : sc;
    target.addEventListener('scroll', update, { passive: true });
    const onResize = () => {
      // Celular ↔ escritorio: puede cambiar quién desplaza.
      scrollerRef.current = findScroller();
      update();
    };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (sc !== window) ro?.observe(sc as HTMLElement);
    ro?.observe(el);
    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [ref, findScroller, update, empty]);

  // Cambió la cantidad de filas (o se dibujó la primera y ya se puede medir): se recalcula sin esperar al scroll.
  useLayoutEffect(() => {
    update();
  }, [count, update]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const m = measure();
      if (!m) return;
      const h = rowRef.current;
      const rowTop = m.offset + index * h;
      const rowBottom = rowTop + h;
      let top: number | null = null;
      if (rowTop < m.scrollTop) top = rowTop;
      else if (rowBottom > m.scrollTop + m.viewport) top = rowBottom - m.viewport;
      if (top === null) return;
      const sc = scrollerRef.current ?? window;
      if (sc === window) window.scrollTo({ top });
      else (sc as HTMLElement).scrollTop = top;
      update();
    },
    [measure, update],
  );

  return { ...range, scrollToIndex };
}
