// Pista de notas dibujada en canvas. Horizontal (batería/pads) o vertical (teclado).
import { useEffect, useRef } from 'react';
import type { HitJudgement, Instrument, LessonStep } from '../engine/types';
import { lanesFor, KEYS_LOW, isBlackKey, noteName } from '../engine/instruments';
import { JUDGEMENT_COLORS } from '../engine/scoring';
import type { LessonPlayer, PlayerState } from '../engine/player';

export interface KeyLayout {
  lo: number;
  hi: number;
  whiteW: number;
  /** x (px) del borde izquierdo de cada tecla y ancho. */
  pos: Map<number, { x: number; w: number }>;
  width: number;
}

export function computeKeyLayout(lo: number, hi: number, width: number): KeyLayout {
  // aseguramos empezar/terminar en teclas blancas
  while (isBlackKey(lo)) lo--;
  while (isBlackKey(hi)) hi++;
  let whites = 0;
  for (let n = lo; n <= hi; n++) if (!isBlackKey(n)) whites++;
  const whiteW = width / whites;
  const pos = new Map<number, { x: number; w: number }>();
  let wx = 0;
  for (let n = lo; n <= hi; n++) {
    if (!isBlackKey(n)) {
      pos.set(n, { x: wx, w: whiteW });
      wx += whiteW;
    } else {
      pos.set(n, { x: wx - whiteW * 0.3, w: whiteW * 0.6 });
    }
  }
  return { lo, hi, whiteW, pos, width };
}

export function stepKeyRange(step: LessonStep): [number, number] {
  const pitches = step.notes.map((n) => Number(n.lane)).filter((n) => !Number.isNaN(n));
  if (pitches.length === 0) return [60, 72];
  let lo = Math.min(...pitches) - 2;
  let hi = Math.max(...pitches) + 2;
  // mínimo ~ 1.5 octavas
  while (hi - lo < 17) {
    lo--;
    hi++;
  }
  lo = Math.max(KEYS_LOW - 12, lo);
  return [lo, hi];
}

interface Props {
  instrument: Instrument;
  step: LessonStep;
  player: LessonPlayer;
  noteSpeed: 1 | 2 | 3;
  latinNames: boolean;
  showHands: boolean;
  keyLayout?: KeyLayout;
  loop: [number, number] | null;
  loopEnabled: boolean;
}

export function Highway({ instrument, step, player, noteSpeed, latinNames, showHands, keyLayout, loop, loopEnabled }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<PlayerState>(player.state);
  const propsRef = useRef({ keyLayout, loop, loopEnabled, noteSpeed });
  propsRef.current = { keyLayout, loop, loopEnabled, noteSpeed };

  useEffect(() => {
    const unsub = player.subscribe((s) => (stateRef.current = s));
    return () => {
      unsub();
    };
  }, [player]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const laneDefs = lanesFor(instrument);
    const usedLanes = instrument === 'keys' ? [] : laneDefs.filter((l) => step.notes.some((n) => n.lane === l.id));
    const laneIndex = new Map(usedLanes.map((l, i) => [l.id, i]));
    const beatsPerBar = player.beatsPerBar;
    const totalBeats = player.totalBeats;
    const sorted = step.notes.map((n, idx) => ({ ...n, idx }));

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const dpr = Math.min(W < 700 ? 1.5 : 2, window.devicePixelRatio || 1);
      if (W === 0 || H === 0) return;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const st = stateRef.current;
      const { keyLayout: kl, loop: lp, loopEnabled: lpOn, noteSpeed: spd } = propsRef.current;
      const beat = st.status === 'idle' ? 0 : st.beat;
      const dark = getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() !== 'light';
      const lineCol = dark ? 'rgba(255,255,255,' : 'rgba(0,0,0,';
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);

      if (instrument !== 'keys') {
        // ---- Horizontal ----
        const labelW = W < 500 ? 44 : 70;
        const hitX = labelW + 26;
        const pxPerBeat = Math.max(40, ((W - hitX) / (beatsPerBar * (spd === 1 ? 3 : spd === 2 ? 2 : 1.4))));
        const rows = Math.max(1, usedLanes.length);
        const rowH = H / rows;
        const xOf = (b: number) => hitX + (b - beat) * pxPerBeat;
        // fondo de filas
        usedLanes.forEach((l, i) => {
          ctx.fillStyle = i % 2 === 0 ? `${lineCol}0.03)` : 'transparent';
          ctx.fillRect(0, i * rowH, W, rowH);
          ctx.fillStyle = l.color;
          ctx.globalAlpha = 0.9;
          ctx.font = `700 ${W < 500 ? 11 : 12}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(W < 500 ? l.shortLabel : l.label, 8, i * rowH + rowH / 2);
          ctx.globalAlpha = 1;
        });
        // loop
        if (lpOn && lp) {
          const x0 = xOf(lp[0] * beatsPerBar);
          const x1 = xOf(lp[1] * beatsPerBar);
          ctx.fillStyle = 'rgba(34,211,238,0.07)';
          ctx.fillRect(Math.max(hitX - 26, x0), 0, x1 - x0, H);
        }
        // líneas de compás/tiempo
        for (let b = 0; b <= totalBeats; b++) {
          const x = xOf(b);
          if (x < labelW || x > W) continue;
          const bar = b % beatsPerBar === 0;
          ctx.strokeStyle = `${lineCol}${bar ? 0.25 : 0.08})`;
          ctx.lineWidth = bar ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
          if (bar && b < totalBeats) {
            ctx.fillStyle = `${lineCol}0.35)`;
            ctx.font = '600 11px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(String(b / beatsPerBar + 1), x + 4, 4);
          }
        }
        // línea de golpe con halo (gradiente, sin shadowBlur)
        const halo = ctx.createLinearGradient(hitX - 22, 0, hitX + 22, 0);
        halo.addColorStop(0, 'rgba(255,255,255,0)');
        halo.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        halo.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(hitX - 22, 0, 44, H);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(hitX - 1, 0, 2, H);
        // notas
        const r = Math.min(rowH * 0.32, 15);
        for (const n of sorted) {
          const x = xOf(n.beat);
          if (x < labelW - r || x > W + r) continue;
          const row = laneIndex.get(n.lane) ?? 0;
          const y = row * rowH + rowH / 2;
          const j = st.noteStates[n.idx];
          const laneCol = usedLanes[row]?.color ?? '#fff';
          drawNote(ctx, x, y, r, laneCol, j, x < hitX, st.status === 'waiting' && Math.abs(n.beat - beat) < 1e-6 && j == null ? pulse : 0);
        }
      } else if (kl) {
        // ---- Vertical (teclado) ----
        const hitY = H - 6;
        const pxPerBeat = Math.max(40, (H / (beatsPerBar * (spd === 1 ? 2.2 : spd === 2 ? 1.6 : 1.1))));
        const yOf = (b: number) => hitY - (b - beat) * pxPerBeat;
        // columnas de teclas
        for (let n = kl.lo; n <= kl.hi; n++) {
          const p = kl.pos.get(n)!;
          if (isBlackKey(n)) {
            ctx.fillStyle = `${lineCol}0.06)`;
            ctx.fillRect(p.x, 0, p.w, H);
          } else if (n % 12 === 0) {
            ctx.strokeStyle = `${lineCol}0.18)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, 0);
            ctx.lineTo(p.x, H);
            ctx.stroke();
            ctx.fillStyle = `${lineCol}0.3)`;
            ctx.font = '600 10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(noteName(n, latinNames), p.x + 3, H - 10);
          }
        }
        if (lpOn && lp) {
          const y0 = yOf(lp[0] * beatsPerBar);
          const y1 = yOf(lp[1] * beatsPerBar);
          ctx.fillStyle = 'rgba(34,211,238,0.07)';
          ctx.fillRect(0, y1, W, y0 - y1);
        }
        for (let b = 0; b <= totalBeats; b++) {
          const y = yOf(b);
          if (y < 0 || y > H) continue;
          const bar = b % beatsPerBar === 0;
          ctx.strokeStyle = `${lineCol}${bar ? 0.25 : 0.08})`;
          ctx.lineWidth = bar ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
          if (bar && b < totalBeats) {
            ctx.fillStyle = `${lineCol}0.35)`;
            ctx.font = '600 11px Inter, system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(String(b / beatsPerBar + 1), W - 6, y - 3);
          }
        }
        const haloV = ctx.createLinearGradient(0, hitY - 26, 0, hitY + 6);
        haloV.addColorStop(0, 'rgba(255,255,255,0)');
        haloV.addColorStop(1, 'rgba(255,255,255,0.12)');
        ctx.fillStyle = haloV;
        ctx.fillRect(0, hitY - 26, W, 32);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(0, hitY - 1, W, 2);
        for (const n of sorted) {
          const p = kl.pos.get(Number(n.lane));
          if (!p) continue;
          const dur = Math.max(0.25, n.dur ?? 0.5);
          const yBottom = yOf(n.beat);
          const len = dur * pxPerBeat - 3;
          const yTop = yBottom - len;
          if (yBottom < -10 || yTop > H + 10) continue;
          const j = st.noteStates[n.idx];
          const base = showHands ? (n.hand === 'L' ? '#38bdf8' : '#a78bfa') : isBlackKey(Number(n.lane)) ? '#8b5cf6' : '#a78bfa';
          const col = j ? JUDGEMENT_COLORS[j] : base;
          const isWaiting = st.status === 'waiting' && Math.abs(n.beat - beat) < 1e-6 && j == null;
          ctx.globalAlpha = yBottom > hitY + 4 && !j ? 0.35 : 1;
          if (isWaiting) {
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.18 + pulse * 0.2;
            roundRect(ctx, p.x - 4, Math.max(-len, yTop) - 4, p.w + 5, len + 8, 8);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          const grad = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
          grad.addColorStop(0, col);
          grad.addColorStop(1, shade(col, -18));
          ctx.fillStyle = grad;
          roundRect(ctx, p.x + 1.5, Math.max(-len, yTop), p.w - 3, len, 5);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          roundRect(ctx, p.x + 3, Math.max(-len, yTop) + 1.5, Math.max(2, p.w - 6), 2, 1);
          ctx.fill();
          if (j === 'miss') {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.x + 4, yBottom - 4);
            ctx.lineTo(p.x + p.w - 4, yBottom - len + 4);
            ctx.stroke();
          }
          if (showHands && n.hand && p.w > 18 && len > 16) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.font = '700 10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(n.hand, p.x + p.w / 2, yBottom - 3);
          }
          ctx.globalAlpha = 1;
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [instrument, step, player, latinNames, showHands]);

  return <canvas ref={ref} />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, laneCol: string, j: HitJudgement | null, passed: boolean, pulse: number) {
  const col = j ? JUDGEMENT_COLORS[j] : laneCol;
  ctx.globalAlpha = passed && !j ? 0.3 : passed ? 0.8 : 1;
  if (pulse) {
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.15 + pulse * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // halo suave
  const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.6);
  g.addColorStop(0, col + (j ? '55' : '40'));
  g.addColorStop(1, col + '00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  // cuerpo con leve gradiente
  const body = ctx.createLinearGradient(x, y - r, x, y + r);
  body.addColorStop(0, shade(col, 22));
  body.addColorStop(1, shade(col, -14));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (j === 'miss') {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.45, y - r * 0.45);
    ctx.lineTo(x + r * 0.45, y + r * 0.45);
    ctx.moveTo(x + r * 0.45, y - r * 0.45);
    ctx.lineTo(x - r * 0.45, y + r * 0.45);
    ctx.stroke();
  } else if (j === 'perfect') {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.45, y);
    ctx.lineTo(x - r * 0.1, y + r * 0.38);
    ctx.lineTo(x + r * 0.5, y - r * 0.38);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Aclara (>0) u oscurece (<0) un color hex en porcentaje. */
function shade(hex: string, pct: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = pct / 100;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
