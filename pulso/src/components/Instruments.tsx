// Instrumentos táctiles en pantalla: batería, pads 4x4 y piano.
import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { DRUM_LANES, PAD_LANES, isBlackKey, noteName, pitchToKeyLabel } from '../engine/instruments';
import { inputManager } from '../input/inputManager';
import type { KeyLayout } from './Highway';
import { useStore } from '../store/useStore';

function useHitFlash() {
  const [hits, setHits] = useState<Record<string, number>>({});
  useEffect(() => {
    return inputManager.subscribe((e) => {
      if (e.type !== 'on') return;
      setHits((h) => ({ ...h, [e.lane]: Date.now() }));
      window.setTimeout(() => setHits((h) => (Date.now() - (h[e.lane] ?? 0) >= 110 ? { ...h, [e.lane]: 0 } : h)), 120);
    });
  }, []);
  return hits;
}

function vibrate() {
  if (useStore.getState().settings.haptics && 'vibrate' in navigator) {
    try {
      navigator.vibrate(8);
    } catch {
      /* ignore */
    }
  }
}

function usePress(lane: string) {
  return {
    onPointerDown: (e: RPE) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      inputManager.touch(lane, 'on');
      vibrate();
    },
    onPointerUp: () => inputManager.touch(lane, 'off', 0),
    onPointerCancel: () => inputManager.touch(lane, 'off', 0),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

function Pad({ lane, label, color, keyLabel, hit, cue, style }: { lane: string; label: string; color: string; keyLabel?: string; hit: boolean; cue: boolean; style?: React.CSSProperties }) {
  const press = usePress(lane);
  const showKeys = useStore((s) => s.settings.showKeyLabels);
  return (
    <button className={`pad ${hit ? 'hit' : ''} ${cue ? 'cue' : ''}`} style={{ background: `linear-gradient(180deg, ${color}cc, ${color}77)`, ...style }} {...press} aria-label={label}>
      {label}
      {showKeys && keyLabel && <span className="kl">{keyLabel}</span>}
    </button>
  );
}

export function DrumKit({ cues }: { cues: Set<string> }) {
  const hits = useHitFlash();
  const by = Object.fromEntries(DRUM_LANES.map((l) => [l.id, l]));
  const order = ['crash', 'hihat', 'tom1', 'ride', 'snare', 'tom2', 'floor', 'kick'];
  return (
    <div className="drumkit">
      {order.map((id) => {
        const l = by[id];
        return <Pad key={id} lane={id} label={l.label} color={l.color} keyLabel={l.keyLabel} hit={!!hits[id]} cue={cues.has(id)} style={id === 'kick' ? { gridColumn: 'span 1' } : undefined} />;
      })}
    </div>
  );
}

export function PadGrid({ cues }: { cues: Set<string> }) {
  const hits = useHitFlash();
  return (
    <div className="padgrid">
      {PAD_LANES.map((l, i) => (
        <Pad key={l.id} lane={l.id} label={String(i + 1)} color={l.color} keyLabel={l.keyLabel} hit={!!hits[l.id]} cue={cues.has(l.id)} />
      ))}
    </div>
  );
}

export function Piano({ layout, cues }: { layout: KeyLayout; cues: Set<string> }) {
  const hits = useHitFlash();
  const latin = useStore((s) => s.settings.latinNames);
  const showKeys = useStore((s) => s.settings.showKeyLabels);
  const inputMethod = useStore((s) => s.inputMethod);
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<Map<number, number>>(new Map());
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const octaveShift = inputManager.getOctaveShift();

  const keyAt = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const k = el?.closest('[data-key]') as HTMLElement | null;
    return k ? Number(k.dataset.key) : null;
  };
  const down = (e: RPE) => {
    e.preventDefault();
    const k = keyAt(e.clientX, e.clientY);
    if (k == null) return;
    active.current.set(e.pointerId, k);
    inputManager.touch(String(k), 'on');
    vibrate();
  };
  const move = (e: RPE) => {
    if (!active.current.has(e.pointerId)) return;
    const k = keyAt(e.clientX, e.clientY);
    const prev = active.current.get(e.pointerId)!;
    if (k != null && k !== prev) {
      inputManager.touch(String(prev), 'off', 0);
      active.current.set(e.pointerId, k);
      inputManager.touch(String(k), 'on');
    }
  };
  const up = (e: RPE) => {
    const k = active.current.get(e.pointerId);
    if (k != null) inputManager.touch(String(k), 'off', 0);
    active.current.delete(e.pointerId);
  };

  const keys: number[] = [];
  for (let n = layout.lo; n <= layout.hi; n++) keys.push(n);
  return (
    <div className="piano" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()} style={{ touchAction: 'none' }}>
      <div className="piano-inner" style={{ width: layout.width }}>
        {keys.map((n) => {
          const p = layout.pos.get(n)!;
          const black = isBlackKey(n);
          const kl = inputMethod === 'keyboard' && showKeys ? pitchToKeyLabel(n, octaveShift) : null;
          return (
            <div key={n} data-key={n} className={`key ${black ? 'black' : 'white'} ${hits[String(n)] ? 'hit' : ''} ${cues.has(String(n)) ? 'cue' : ''}`} style={{ left: p.x, width: p.w }}>
              {kl && <span className="kl">{kl}</span>}
              {!black && p.w > 22 && (n % 12 === 0 || p.w > 34) ? noteName(n, latin) : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}
