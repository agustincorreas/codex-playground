// Reglas de alerta en tiempo real. Corren solo para acciones "elegibles" (en rango de precio y con
// volumen), igual que el scanner de máximos del día de Ross Cameron, que solo avisa en acciones que
// ya cumplen sus criterios.
import { floatOf, levelStep, priceTick, rvolOf } from './metrics';
import type { SymbolState } from './symbol';
import type { AlertType, Session, Settings, Tone, TradePlan } from './types';

const MIN = 60_000;

export interface AlertSink {
  now: number;
  settings: Settings;
  session: Session;
  /** Fracción esperada del volumen diario a esta hora (para el volumen relativo). */
  volFrac: number;
  isWatched(sym: string): boolean;
  emit(st: SymbolState, type: AlertType, text: string, tone: Tone, plan?: TradePlan): void;
}

interface Candidate {
  type: AlertType;
  text: string;
  tone: Tone;
  plan?: TradePlan;
}

// Si un mismo print dispara varias reglas, se emiten las más importantes primero (máximo 3).
const PRIORITY: AlertType[] = [
  'bullFlag',
  'squeeze',
  'hod',
  'pmhBreak',
  'running',
  'volume',
  'redToGreen',
  'vwapReclaim',
  'flush',
  'vwapLoss',
  'nearHod',
  'level',
  'stacking',
  'rotation',
];
const MAX_PER_UPDATE = 3;

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);
const round = (p: number) => Math.round(p * 10000) / 10000;

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

export function fmtVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(v));
}

export function isEligible(st: SymbolState, s: Settings, watched: boolean): boolean {
  return watched || (st.last >= s.priceMin && st.last <= s.priceMax && st.volume >= s.minVolume * 0.5);
}

function avgPrevVolume(st: SymbolState, n: number): number {
  const end = st.bars.length - 1;
  const start = Math.max(0, end - n);
  if (end - start < 3) return 0;
  let v = 0;
  for (let i = start; i < end; i++) v += st.bars[i].v;
  return v / (end - start);
}

function lowWithTime(st: SymbolState, now: number, minutes: number): { low: number; t: number } {
  const from = Math.floor((now - minutes * MIN) / MIN) * MIN;
  let low = st.last;
  let t = now;
  for (let i = st.bars.length - 1; i >= 0; i--) {
    const b = st.bars[i];
    if (b.t < from) break;
    if (b.l <= low) {
      low = b.l;
      t = b.t;
    }
  }
  return { low, t };
}

/** Reglas que se evalúan en cada actualización de precio (print o agregado de 1 segundo). */
export function onPrice(st: SymbolState, sink: AlertSink, newHod: boolean, prev: number, price: number): void {
  const s = sink.settings;
  const now = sink.now;
  st.eligible = isEligible(st, s, sink.isWatched(st.sym));
  const out: Candidate[] = [];

  // Bull flag armado: dispara en la primera vela que supera el máximo de la vela anterior.
  if (st.flag) {
    const f = st.flag;
    if (price >= f.entry) {
      if (st.eligible) {
        out.push({
          type: 'bullFlag',
          text: `Bull flag: primera vela con nuevo máximo · entrada $${fmtPrice(f.entry)} · stop $${fmtPrice(f.stop)}`,
          tone: 'up',
          plan: { entry: f.entry, stop: f.stop, target: f.target },
        });
      }
      st.flag = undefined;
    } else if (price < f.stop || now - f.armedAt > 6 * MIN) {
      st.flag = undefined;
    }
  }

  // Compras apiladas: subas consecutivas sin bajas en el medio.
  if (price > prev) st.upticks++;
  else if (price < prev) st.upticks = 0;

  if (!st.eligible) {
    flush(st, sink, out);
    return;
  }
  const chg = st.changePct;

  if (newHod && chg >= s.hodMinChangePct && st.bars.length >= 2) {
    const fresh = st.cooldownOk('hod', now, 45_000) && price >= st.lastHodAlertPrice * 1.01;
    if (fresh || st.cooldownOk('hod', now, 3 * MIN) || price >= st.lastHodAlertPrice * 1.05) {
      const cur = st.bars[st.bars.length - 1];
      const avg = avgPrevVolume(st, 10);
      const withVol = avg > 0 && cur.v >= avg * 2;
      out.push({ type: 'hod', text: withVol ? 'Nuevo máximo del día con volumen' : 'Nuevo máximo del día', tone: 'up' });
      st.mark('hod', now);
      st.lastHodAlertPrice = price;
    }
  } else if (
    st.hod > 0 &&
    price < st.hod &&
    price >= st.hod * 0.985 &&
    price > prev &&
    chg >= s.minChangePct &&
    now - st.hodTs >= 3 * MIN &&
    st.cooldownOk('nearHod', now, 5 * MIN)
  ) {
    out.push({ type: 'nearHod', text: `Consolidando cerca del máximo ($${fmtPrice(st.hod)})`, tone: 'info' });
    st.mark('nearHod', now);
  }

  // Subidas rápidas y squeezes solo cuentan en acciones que ya suben en el día (rebotes de perdedoras, no).
  const upOnDay = chg >= s.hodMinChangePct;
  const run2 = pct(price, st.lowSince(now, 2));
  if (upOnDay && run2 >= Math.max(5, s.runMinPct5m + 2) && st.cooldownOk('running', now, 5 * MIN)) {
    out.push({ type: 'running', text: `Subiendo rápido: +${run2.toFixed(1)}% en 2 min`, tone: 'up' });
    st.mark('running', now);
  }

  const { low: low15, t: lowT } = lowWithTime(st, now, 15);
  const sq = pct(price, low15);
  if (sq < 5) st.squeezeLevel = 0;
  else if (upOnDay) {
    const level = Math.floor(sq / 10);
    if (level >= 1 && level > st.squeezeLevel && st.cooldownOk('squeeze', now, 90_000)) {
      const mins = Math.min(15, Math.max(1, Math.round((now - lowT) / MIN)));
      st.mark('squeeze', now);
      out.push({ type: 'squeeze', text: `Squeeze: +${level * 10}% en ${mins} min`, tone: 'up' });
      st.squeezeLevel = level;
    }
  }

  const cur = st.bars[st.bars.length - 1];
  if (cur && st.memo.get('volBar') !== cur.t && price >= cur.o) {
    const avg = avgPrevVolume(st, 10);
    const fl = floatOf(st).value ?? 0;
    if (avg > 0 && cur.v >= avg * 5 && cur.v >= Math.max(30_000, fl * 0.002)) {
      out.push({
        type: 'volume',
        text: `Pico de volumen: ${fmtVolume(cur.v)} en 1 min (${Math.round(cur.v / avg)}x)`,
        tone: 'info',
      });
      st.memo.set('volBar', cur.t);
    }
  }

  const vw = st.vwap;
  const side: -1 | 0 | 1 = price > vw * 1.003 ? 1 : price < vw * 0.997 ? -1 : 0;
  if (side !== 0 && side !== st.vwapSide) {
    const held = now - st.vwapSideSince;
    if (st.vwapSide === -1 && held >= 2 * MIN && chg >= 5 && st.cooldownOk('vwapR', now, 3 * MIN)) {
      out.push({ type: 'vwapReclaim', text: `Recupera VWAP ($${fmtPrice(vw)})`, tone: 'up' });
      st.mark('vwapR', now);
    } else if (st.vwapSide === 1 && held >= 3 * MIN && chg >= 5 && st.cooldownOk('vwapL', now, 3 * MIN)) {
      out.push({ type: 'vwapLoss', text: `Pierde VWAP ($${fmtPrice(vw)})`, tone: 'warn' });
      st.mark('vwapL', now);
    }
    st.vwapSide = side;
    st.vwapSideSince = now;
  }

  if (
    sink.session === 'regular' &&
    st.pmHigh > 0 &&
    prev <= st.pmHigh &&
    price > st.pmHigh &&
    !st.memo.has('pmh')
  ) {
    out.push({ type: 'pmhBreak', text: `Rompe máximo del pre-market ($${fmtPrice(st.pmHigh)})`, tone: 'up' });
    st.mark('pmh', now);
  }

  if (chg >= s.minChangePct && prev > 0) {
    const step = levelStep(price);
    const level = Math.floor(price / step + 1e-9) * step;
    if (prev < level && price >= level && level > 0) {
      const key = `lvl${level.toFixed(2)}`;
      if (st.cooldownOk(key, now, 30 * MIN)) {
        const kind = step >= 1 || Math.abs(level - Math.round(level)) < 1e-9 ? 'dólar entero' : step === 0.5 ? 'medio dólar' : 'nivel';
        out.push({ type: 'level', text: `Rompe $${fmtPrice(level)} (${kind})`, tone: 'up' });
        st.mark(key, now);
      }
    }
  }

  if (st.prevClose > 0) {
    if (price < st.prevClose) {
      if (!st.belowPrevCloseSince) st.belowPrevCloseSince = now;
    } else {
      if (
        prev < st.prevClose &&
        st.belowPrevCloseSince &&
        now - st.belowPrevCloseSince >= 3 * MIN &&
        rvolOf(st, sink.volFrac) >= 2 &&
        st.cooldownOk('r2g', now, 15 * MIN)
      ) {
        out.push({
          type: 'redToGreen',
          text: `Pasa de rojo a verde (cierre anterior $${fmtPrice(st.prevClose)})`,
          tone: 'up',
        });
        st.mark('r2g', now);
      }
      st.belowPrevCloseSince = 0;
    }
  }

  if (st.upticks >= 10 && chg >= 5 && st.cooldownOk('stack', now, 5 * MIN)) {
    out.push({ type: 'stacking', text: `Compras apiladas: ${st.upticks} subas seguidas`, tone: 'up' });
    st.mark('stack', now);
    st.upticks = 0;
  }

  const high5 = st.highSince(now, 5);
  const drop = pct(price, high5);
  if (drop <= -12 && st.hod >= st.prevClose * 1.15 && st.cooldownOk('flush', now, 10 * MIN)) {
    out.push({ type: 'flush', text: `Flush: ${drop.toFixed(1)}% en 5 min desde $${fmtPrice(high5)}`, tone: 'down' });
    st.mark('flush', now);
  }

  const fl = floatOf(st).value;
  if (fl) {
    const k = Math.floor(st.volume / fl);
    if (k >= 1 && k > st.rotationLevel) {
      st.rotationLevel = k;
      out.push({ type: 'rotation', text: `Rotó el float ${k}x (${fmtVolume(st.volume)} acciones)`, tone: 'info' });
    }
  }

  flush(st, sink, out);
}

function flush(st: SymbolState, sink: AlertSink, out: Candidate[]): void {
  if (!out.length) return;
  out.sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  for (const c of out.slice(0, MAX_PER_UPDATE)) sink.emit(st, c.type, c.text, c.tone, c.plan);
}

/**
 * Al cerrar cada vela de 1 minuto: busca un bull flag (palo con velas verdes, retroceso de 1-4 velas
 * con menos volumen que no devuelve más del 50% y se mantiene sobre el VWAP). Si lo encuentra, queda
 * "armado" y la entrada es el máximo de la vela anterior: la primera vela que hace nuevo máximo.
 */
export function onBarClosed(st: SymbolState, sink: AlertSink): void {
  const s = sink.settings;
  if (!st.eligible || st.changePct < s.minChangePct || st.halted) {
    st.flag = undefined;
    return;
  }
  const n = st.bars.length;
  const closed = st.bars.slice(Math.max(0, n - 13), n - 1);
  if (closed.length < 4) return;
  const last = closed[closed.length - 1];
  const tick = priceTick(last.h);

  if (st.flag) {
    // El retroceso sigue: el stop baja al nuevo mínimo mientras no devuelva más del 50% del palo.
    const f = st.flag;
    const low = Math.min(f.stop + tick, last.l);
    if (last.h > f.poleHigh || f.pullbackBars >= 5 || (f.poleHigh - low) / (f.poleHigh - f.poleLow) > 0.5) {
      st.flag = undefined;
    } else {
      f.pullbackBars++;
      f.stop = round(low - tick);
      f.entry = round(last.h + tick);
      f.target = round(f.entry + 2 * (f.entry - f.stop));
    }
    return;
  }

  let iH = -1;
  let H = 0;
  for (let i = closed.length - 1; i >= Math.max(0, closed.length - 10); i--) {
    if (closed[i].h > H) {
      H = closed[i].h;
      iH = i;
    }
  }
  const pullback = closed.slice(iH + 1);
  if (pullback.length < 1 || pullback.length > 4) return;
  const pole = closed.slice(Math.max(0, iH - 6), iH + 1);
  let L = Infinity;
  for (const b of pole) L = Math.min(L, b.l);
  const greens = pole.filter((b) => b.c > b.o).length;
  if (pct(H, L) < 6 || greens < 2) return;
  if (!pullback.some((b) => b.c < b.o)) return;
  let PL = Infinity;
  for (const b of pullback) PL = Math.min(PL, b.l);
  if ((H - PL) / (H - L) > 0.5) return;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  if (avg(pullback.map((b) => b.v)) >= avg(pole.map((b) => b.v)) * 0.8) return;
  if (last.c < st.vwap) return;
  const entry = round(last.h + tick);
  const stop = round(PL - tick);
  if (entry <= stop) return;
  st.flag = {
    entry,
    stop,
    target: round(entry + 2 * (entry - stop)),
    poleHigh: H,
    poleLow: L,
    armedAt: sink.now,
    pullbackBars: pullback.length,
  };
}
