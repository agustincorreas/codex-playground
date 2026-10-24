import type { ReactNode } from 'react';
import type { ScannerId, ScanRow } from '../../engine/types';
import { fmtFloat, fmtPct, fmtPrice, fmtRvol, fmtVolume, toneOf } from '../lib/format';
import { PillarDots, ScoreDots } from './PillarDots';

export interface Column {
  id: string;
  label: string;
  title?: string;
  className?: string;
  render: (r: ScanRow) => ReactNode;
}

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
  sym: { id: 'sym', label: 'Símb.', className: 'c-sym', render: (r: ScanRow) => <SymCell r={r} /> },
  price: { id: 'price', label: 'Precio', className: 'num', render: (r: ScanRow) => <PriceCell r={r} /> },
  change: { id: 'chg', label: 'Cambio', title: '% vs. cierre anterior', className: 'num', render: (r: ScanRow) => pct(r.changePct) },
  vol: { id: 'vol', label: 'Vol.', title: 'Volumen del día', className: 'num', render: (r: ScanRow) => fmtVolume(r.volume) },
  rvol: { id: 'rvol', label: 'RVOL', title: 'Volumen relativo ajustado por horario', className: 'num', render: (r: ScanRow) => <span className={r.rvol >= 5 ? 't-hot' : ''}>{fmtRvol(r.rvol)}</span> },
  rvol5: { id: 'rvol5', label: 'RVOL 5m', title: 'Volumen de los últimos 5 min vs. 5 min normales', className: 'num', render: (r: ScanRow) => fmtRvol(r.rvol5m) },
  float: {
    id: 'float',
    label: 'Float',
    className: 'num',
    render: (r: ScanRow) => (
      <span className={r.float !== undefined && r.float <= 10e6 ? 't-hot' : ''} title={r.floatEst ? 'Estimado: acciones en circulación' : undefined}>
        {r.floatEst ? '≈' : ''}
        {fmtFloat(r.float)}
      </span>
    ),
  },
  chg1: { id: 'chg1', label: '1 min', className: 'num', render: (r: ScanRow) => pct(r.chg1m) },
  chg5: { id: 'chg5', label: '5 min', className: 'num', render: (r: ScanRow) => pct(r.chg5m) },
  vol5: { id: 'vol5', label: 'Vol. 5m', className: 'num', render: (r: ScanRow) => fmtVolume(r.vol5m) },
  rot: {
    id: 'rot',
    label: 'Rotación',
    title: 'Volumen del día / float',
    className: 'num',
    render: (r: ScanRow) => (r.rotation ? <span className={r.rotation >= 1 ? 't-hot' : ''}>{r.rotation.toFixed(r.rotation < 1 ? 2 : 1)}x</span> : '—'),
  },
  fromHod: { id: 'fhod', label: 'Desde HOD', className: 'num', render: (r: ScanRow) => pct(r.pctFromHod) },
  hod: { id: 'hod', label: 'HOD', title: 'Máximo del día', className: 'num', render: (r: ScanRow) => fmtPrice(r.hod) },
  vwap: { id: 'vwap', label: 'VWAP', className: 'num', render: (r: ScanRow) => <span className={r.price >= r.vwap ? 't-up' : 't-down'}>{fmtPrice(r.vwap)}</span> },
  pillars: {
    id: 'pil',
    label: 'Pilares',
    className: 'c-pil',
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

interface Props {
  rows: ScanRow[];
  columns: Column[];
  selected: string | null;
  onSelect: (sym: string) => void;
  minScoreHighlight?: number;
  extra?: (r: ScanRow) => ReactNode;
}

export function ScannerTable({ rows, columns, selected, onSelect, minScoreHighlight = 5, extra }: Props) {
  return (
    <div className="table-wrap">
      <table className="scan">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} className={c.className} title={c.title}>
                {c.label}
              </th>
            ))}
            {extra && <th aria-label="Acciones" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.sym}
              className={`${r.sym === selected ? 'is-selected' : ''} ${r.score >= minScoreHighlight ? 'is-a' : ''} ${r.halted ? 'is-halted' : ''}`}
              onClick={() => onSelect(r.sym)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(r.sym);
              }}
            >
              {columns.map((c) => (
                <td key={c.id} className={c.className}>
                  {c.render(r)}
                </td>
              ))}
              {extra && <td className="c-extra">{extra(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
