// Espacio de trabajo de escritorio: las ventanas se pueden mover (por la barra de título) y cambiar
// de tamaño (desde los bordes), como en una plataforma de trading. La disposición se guarda en este
// navegador por tamaño de pantalla: en una pantalla grande la grilla ocupa todo el alto.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Responsive, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { load, save } from '../lib/storage';

export type PanelId = 'trades' | 'momo' | 'scan' | 'l2' | 'chart1' | 'chart5' | 'quote' | 'pos' | 'orders';

/** Escritorio grande: 24 columnas y 24 filas que llenan la pantalla. */
const LG_ROWS = 24;
const MARGIN = 6;
/** Notebook: 12 columnas y filas fijas (la página se desplaza, como antes). */
const MD_ROW = 24;
/**
 * Ancho del espacio de trabajo desde el que se usa la disposición de pantalla grande: coincide con
 * las pantallas de 1500 px o más (menos los márgenes), donde la página ocupa justo el alto de la ventana.
 */
const LG_FROM = 1467;

export const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: 'momo', x: 0, y: 0, w: 5, h: 12 },
    { i: 'scan', x: 0, y: 12, w: 5, h: 12 },
    { i: 'trades', x: 5, y: 0, w: 6, h: 4 },
    { i: 'l2', x: 5, y: 4, w: 6, h: 20 },
    { i: 'chart1', x: 11, y: 0, w: 7, h: 12 },
    { i: 'chart5', x: 11, y: 12, w: 7, h: 12 },
    { i: 'pos', x: 18, y: 0, w: 6, h: 8 },
    { i: 'orders', x: 18, y: 8, w: 6, h: 8 },
    { i: 'quote', x: 18, y: 16, w: 6, h: 8 },
  ],
  md: [
    { i: 'trades', x: 0, y: 0, w: 6, h: 4 },
    { i: 'l2', x: 0, y: 4, w: 6, h: 19 },
    { i: 'chart1', x: 6, y: 0, w: 6, h: 23 },
    { i: 'momo', x: 0, y: 23, w: 6, h: 15 },
    { i: 'chart5', x: 6, y: 23, w: 6, h: 15 },
    { i: 'scan', x: 0, y: 38, w: 6, h: 15 },
    { i: 'quote', x: 6, y: 38, w: 6, h: 15 },
    { i: 'pos', x: 0, y: 53, w: 6, h: 12 },
    { i: 'orders', x: 6, y: 53, w: 6, h: 12 },
  ],
};

/** Tamaños mínimos para que cada ventana siga siendo usable. */
const MIN: Partial<Record<PanelId, { w: number; h: number }>> = {
  l2: { w: 4, h: 10 },
  chart1: { w: 3, h: 5 },
  chart5: { w: 3, h: 5 },
  trades: { w: 3, h: 3 },
};

const STORE_KEY = 'layouts-v1';

/** La disposición guardada, completada con las ventanas que falten (por ejemplo, una ventana nueva). */
function restore(ids: PanelId[]): Layouts {
  const saved = load<Layouts | null>(STORE_KEY, null);
  const out: Layouts = {};
  for (const bp of Object.keys(DEFAULT_LAYOUTS)) {
    const def = DEFAULT_LAYOUTS[bp];
    const mine = (saved?.[bp] ?? []).filter((l) => ids.includes(l.i as PanelId));
    const missing = def.filter((d) => !mine.some((l) => l.i === d.i));
    out[bp] = withMins([...mine, ...missing]);
  }
  return out;
}

function withMins(list: Layout[]): Layout[] {
  return list.map((l) => {
    const m = MIN[l.i as PanelId];
    return { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, minW: m?.w ?? 2, minH: m?.h ?? 3 };
  });
}

interface Props {
  panels: Record<PanelId, ReactNode>;
  editing: boolean;
  /** Para volver a la disposición original. */
  resetKey: number;
}

export function WindowGrid({ panels, editing, resetKey }: Props) {
  const ids = Object.keys(panels) as PanelId[];
  const [layouts, setLayouts] = useState<Layouts>(() => restore(ids));
  const host = useRef<HTMLElement>(null);
  // El ancho y el alto disponibles se miden acá (la grilla se arma recién con la primera medida).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Volver a la disposición original.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    save(STORE_KEY, null);
    setLayouts(restore(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setSize((prev) => (prev && prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lg = !!size && size.w > LG_FROM;
  // En la pantalla grande, las 24 filas llenan el alto disponible (y crecen con la pantalla).
  const rowHeight = lg && size ? Math.max(14, Math.floor((size.h - 2 * MARGIN - (LG_ROWS - 1) * MARGIN) / LG_ROWS)) : MD_ROW;

  return (
    <main ref={host} className={`workspace ${editing ? 'is-editing' : ''} ${lg ? 'ws-lg' : 'ws-md'}`}>
      {size && size.w > 0 && (
        <Responsive
          className="ws-grid"
          width={size.w}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={rowHeight}
          margin={GAP}
          containerPadding={PAD}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".panel-head"
          draggableCancel="input, select, textarea"
          resizeHandles={HANDLES}
          compactType="vertical"
          onLayoutChange={(_cur, all) => {
            const clean: Layouts = {};
            for (const [bp, list] of Object.entries(all)) clean[bp] = list.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
            setLayouts(all);
            save(STORE_KEY, clean);
          }}
        >
          {ids.map((id) => (
            <div key={id} className={`ws-item ws-${id}`}>
              {panels[id]}
            </div>
          ))}
        </Responsive>
      )}
    </main>
  );
}

// Objetos fijos: la grilla compara algunas props por referencia y las nuevas en cada render la harían
// recalcular la disposición.
const BREAKPOINTS = { lg: LG_FROM, md: 0 };
const COLS = { lg: 24, md: 12 };
const GAP: [number, number] = [MARGIN, MARGIN];
const PAD: [number, number] = [0, MARGIN];
const HANDLES: Array<'se' | 's' | 'e' | 'w' | 'sw'> = ['se', 's', 'e', 'w', 'sw'];
