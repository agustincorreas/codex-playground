import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ScannerId, ScanRow } from '../../engine/types';
import { fmtFloat, fmtPct, fmtPrice, fmtRvol, fmtVolume, toneOf } from '../lib/format';
import { load, save } from '../lib/storage';
import { useVirtualRows } from '../lib/virtual';
import { PillarDots, ScoreDots } from './PillarDots';

export interface Column {
  id: string;
  label: string;
  title?: string;
  className?: string;
  render: (r: ScanRow) => ReactNode;
  /** Valor por el que se ordena al tocar el título (sin esto, la columna no ordena). */
  sort?: (r: ScanRow) => number | string;
}

/** Orden elegido en una tabla: columna y sentido. Sin orden, las filas vienen como las manda el escáner. */
export interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

const num = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? -Infinity : v);

const pct = (v: number) => <span className={`t-${toneOf(v)}`}>{fmtPct(v)}</span>;

function SymCell({ r }: { r: ScanRow }) {
  return (
    <span className="sym-cell" title={r.name}>
      <b>{r.sym}</b>
      {r.halted && <i className="mini halt" title="Halt en curso">H</i>}
      {r.hasNews && <i className="mini news" title="Tiene noticia reciente">N</i>}
      {r.flags && r.flags.length > 0 && (
        <i className="mini flag" title={r.flags.join(' · ')}>
          !
        </i>
      )}
    </span>
  );
}

function PriceCell({ r }: { r: ScanRow }) {
  // La key cambia con el precio: el navegador reinicia la animación de "flash" en cada cambio.
  return (
    <span key={r.price} className={`price flash-${r.dir === 1 ? 'up' : r.dir === -1 ? 'down' : 'none'}`}>
      {fmtPrice(r.price)}
    </span>
  );
}

const C = {
  sym: { id: 'sym', label: 'Símb.', className: 'c-sym', render: (r: ScanRow) => <SymCell r={r} />, sort: (r: ScanRow) => r.sym },
  price: { id: 'price', label: 'Precio', className: 'num', render: (r: ScanRow) => <PriceCell r={r} />, sort: (r: ScanRow) => r.price },
  change: { id: 'chg', label: 'Cambio', title: '% vs. cierre anterior', className: 'num', render: (r: ScanRow) => pct(r.changePct), sort: (r: ScanRow) => r.changePct },
  vol: { id: 'vol', label: 'Vol.', title: 'Volumen del día', className: 'num', render: (r: ScanRow) => fmtVolume(r.volume), sort: (r: ScanRow) => r.volume },
  rvol: { id: 'rvol', label: 'RVOL', title: 'Volumen relativo ajustado por horario', className: 'num', render: (r: ScanRow) => <span className={r.rvol >= 5 ? 't-hot' : ''}>{fmtRvol(r.rvol)}</span>, sort: (r: ScanRow) => r.rvol },
  rvol5: { id: 'rvol5', label: 'RVOL 5m', title: 'Volumen de los últimos 5 min vs. 5 min normales', className: 'num', render: (r: ScanRow) => fmtRvol(r.rvol5m), sort: (r: ScanRow) => r.rvol5m },
  float: {
    id: 'float',
    label: 'Float',
    className: 'num',
    sort: (r: ScanRow) => num(r.float),
    render: (r: ScanRow) => (
      <span className={r.float !== undefined && r.float <= 10e6 ? 't-hot' : ''} title={r.floatEst ? 'Estimado: acciones en circulación' : undefined}>
        {r.floatEst ? '≈' : ''}
        {fmtFloat(r.float)}
      </span>
    ),
  },
  chg1: { id: 'chg1', label: '1 min', className: 'num', render: (r: ScanRow) => pct(r.chg1m), sort: (r: ScanRow) => r.chg1m },
  chg5: { id: 'chg5', label: '5 min', className: 'num', render: (r: ScanRow) => pct(r.chg5m), sort: (r: ScanRow) => r.chg5m },
  vol5: { id: 'vol5', label: 'Vol. 5m', className: 'num', render: (r: ScanRow) => fmtVolume(r.vol5m), sort: (r: ScanRow) => r.vol5m },
  rot: {
    id: 'rot',
    label: 'Rotación',
    title: 'Volumen del día / float',
    className: 'num',
    sort: (r: ScanRow) => num(r.rotation),
    render: (r: ScanRow) => (r.rotation ? <span className={r.rotation >= 1 ? 't-hot' : ''}>{r.rotation.toFixed(r.rotation < 1 ? 2 : 1)}x</span> : '—'),
  },
  fromHod: { id: 'fhod', label: 'Desde HOD', className: 'num', render: (r: ScanRow) => pct(r.pctFromHod), sort: (r: ScanRow) => r.pctFromHod },
  hod: { id: 'hod', label: 'HOD', title: 'Máximo del día', className: 'num', render: (r: ScanRow) => fmtPrice(r.hod), sort: (r: ScanRow) => r.hod },
  vwap: { id: 'vwap', label: 'VWAP', className: 'num', render: (r: ScanRow) => <span className={r.price >= r.vwap ? 't-up' : 't-down'}>{fmtPrice(r.vwap)}</span>, sort: (r: ScanRow) => r.vwap },
  pillars: {
    id: 'pil',
    label: 'Pilares',
    className: 'c-pil',
    sort: (r: ScanRow) => r.score,
    render: (r: ScanRow) => (
      <>
        <PillarDots pillars={r.pillars} />
        <ScoreDots score={r.score} />
      </>
    ),
  },
} satisfies Record<string, Column>;

export const SCANNER_COLUMNS: Record<ScannerId | 'watch', Column[]> = {
  gappers: [C.sym, C.price, C.change, C.vol, C.rvol, C.float, C.pillars],
  pillars: [C.sym, C.price, C.change, C.rvol, C.float, C.pillars],
  running: [C.sym, C.price, C.chg1, C.chg5, C.vol5, C.rvol, C.float],
  lowFloat: [C.sym, C.price, C.change, C.float, C.rot, C.rvol],
  rvol: [C.sym, C.price, C.rvol, C.rvol5, C.vol, C.change],
  fades: [C.sym, C.price, C.change, C.fromHod, C.hod, C.vwap],
  watch: [C.sym, C.price, C.change, C.vol, C.rvol, C.float],
};

/** Ordena una copia de las filas por la columna elegida (estable: los empates quedan como venían). */
export function sortRows(rows: ScanRow[], columns: Column[], sort: SortState | null): ScanRow[] {
  const col = sort && columns.find((c) => c.id === sort.id);
  if (!col?.sort) return rows;
  const key = col.sort;
  const m = sort!.dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      const d = typeof a.k === 'string' || typeof b.k === 'string' ? String(a.k).localeCompare(String(b.k)) : a.k - b.k;
      return d ? d * m : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Siguiente orden al tocar un título: de mayor a menor, de menor a mayor y de vuelta al del escáner. */
export function nextSort(cur: SortState | null, id: string, textual: boolean): SortState | null {
  if (!cur || cur.id !== id) return { id, dir: textual ? 'asc' : 'desc' };
  if (cur.dir === (textual ? 'asc' : 'desc')) return { id, dir: textual ? 'desc' : 'asc' };
  return null;
}

interface Props {
  rows: ScanRow[];
  columns: Column[];
  selected: string | null;
  onSelect: (sym: string) => void;
  minScoreHighlight?: number;
  extra?: (r: ScanRow) => ReactNode;
  /** Clave para recordar el orden elegido (por escáner). Sin clave, no se puede ordenar. */
  sortKey?: string;
}

/** Alto estimado de una fila (se mide la real al dibujar la primera). */
const ROW_H = 26;

export const ScannerTable = memo(function ScannerTable({ rows, columns, selected, onSelect, minScoreHighlight = 5, extra, sortKey }: Props) {
  const storage = sortKey ? `sort-${sortKey}` : null;
  const [sort, setSort] = useState<SortState | null>(() => (storage ? load<SortState | null>(storage, null) : null));
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);
  const toggle = (c: Column) => {
    if (!c.sort || !storage) return;
    const next = nextSort(sort, c.id, c.id === 'sym');
    setSort(next);
    save(storage, next);
  };
  // Solo se dibujan las filas que entran en la ventana (el panel en el escritorio, la página en el celular).
  const body = useRef<HTMLTableSectionElement>(null);
  const v = useVirtualRows(body, ROW_H, sorted.length, { scroller: '.panel-body', overscan: 8 });
  const cols = columns.length + (extra ? 1 : 0);
  // Fila a enfocar después de desplazarse hasta ella (flechas del teclado).
  const focusIndex = useRef<number | null>(null);
  useEffect(() => {
    const i = focusIndex.current;
    if (i === null) return;
    focusIndex.current = null;
    body.current?.querySelector<HTMLElement>(`[data-vrow="${i}"]`)?.focus({ preventScroll: true });
  });
  // La acción elegida desde otro panel (buscador, alertas) se trae a la vista.
  useEffect(() => {
    if (!selected) return;
    const i = sorted.findIndex((r) => r.sym === selected);
    if (i >= 0 && (i < v.start || i >= v.end)) v.scrollToIndex(i);
    // Solo al cambiar la selección, no con cada tick de la tabla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(sorted[i].sym);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : sorted.length - 1;
    if (next < 0 || next >= sorted.length) return;
    e.preventDefault();
    v.scrollToIndex(next);
    const el = body.current?.querySelector<HTMLElement>(`[data-vrow="${next}"]`);
    if (el) el.focus({ preventScroll: true });
    else focusIndex.current = next;
  };
  return (
    <div className="table-wrap">
      <table className="scan">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.id === c.id;
              const canSort = !!c.sort && !!storage;
              return (
                <th key={c.id} scope="col" className={`${c.className ?? ''} ${canSort ? 'sortable' : ''} ${active ? 'is-sorted' : ''}`} title={canSort ? undefined : c.title} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {canSort ? (
                    // Un botón de verdad: se ordena también con Tab y Enter.
                    <button type="button" className="th-btn" onClick={() => toggle(c)} title={`${c.title ? `${c.title}. ` : ''}Ordenar por ${c.label}`}>
                      {c.label}
                      {active && <span className="sort-arrow">{sort!.dir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
            {extra && <th scope="col" aria-label="Acciones" />}
          </tr>
        </thead>
        <tbody ref={body}>
          {v.top > 0 && (
            <tr className="v-spacer" style={{ height: v.top }} aria-hidden="true">
              <td colSpan={cols} />
            </tr>
          )}
          {sorted.slice(v.start, v.end).map((r, k) => {
            const i = v.start + k;
            return (
              <tr
                key={r.sym}
                data-vrow={i}
                className={`${r.sym === selected ? 'is-selected' : ''} ${r.score >= minScoreHighlight ? 'is-a' : ''} ${r.halted ? 'is-halted' : ''}`}
                onClick={() => onSelect(r.sym)}
                tabIndex={0}
                aria-selected={r.sym === selected}
                onKeyDown={(e) => onRowKey(e, i)}
              >
                {columns.map((c) => (
                  <td key={c.id} className={c.className}>
                    {c.render(r)}
                  </td>
                ))}
                {extra && <td className="c-extra">{extra(r)}</td>}
              </tr>
            );
          })}
          {v.bottom > 0 && (
            <tr className="v-spacer" style={{ height: v.bottom }} aria-hidden="true">
              <td colSpan={cols} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
});
