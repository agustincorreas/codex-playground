// Análisis de cómo te está yendo: los hechos que importan (resultado, aciertos, relación G/P, R,
// rachas, horarios y setups) resumidos para pedirle un párrafo a la IA; y, donde no hay IA (la página
// pública o la app sin conexión a Claude), el mismo análisis redactado con reglas.
import { breakdown, summarize, type Summary, type WeekResult } from '../../trading/stats';
import type { Trade } from '../../trading/types';

export interface ReviewFacts {
  trades: number;
  days: number;
  net: number;
  capital: number;
  winRate: number;
  plRatio: number;
  profitFactor: number;
  expectancy: number;
  avgR?: number;
  maxDrawdown: number;
  bestStreak: number;
  worstStreak: number;
  avgWinHoldMin: number;
  avgLossHoldMin: number;
  largestWin: number;
  largestLoss: number;
  withStopPct: number;
  bestHour?: { label: string; net: number; trades: number };
  worstHour?: { label: string; net: number; trades: number };
  bestSetup?: { label: string; net: number; trades: number; winRate: number };
  worstSetup?: { label: string; net: number; trades: number; winRate: number };
  lastWeek?: { week: number; net: number; trades: number; winRate: number; plRatio: number; score: number };
  lastDays: Array<{ day: number; net: number; trades: number }>;
}

const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${v.toFixed(0)} %`;

export function buildFacts(trades: Trade[], s: Summary, weeks: WeekResult[], capital: number, dayOf: (t: Trade) => number | undefined): ReviewFacts {
  const hours = breakdown(trades, 'hora').filter((b) => b.trades >= 3);
  const setups = breakdown(trades, 'setup').filter((b) => b.trades >= 3 && b.key !== '—');
  const byNet = <T extends { net: number }>(xs: T[]) => [...xs].sort((a, b) => b.net - a.net);
  const lw = weeks[weeks.length - 1];
  const byDay = new Map<number, Trade[]>();
  for (const t of trades) {
    const d = dayOf(t);
    if (d === undefined) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const lastDays = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-5)
    .map(([day, list]) => ({ day, net: summarize(list).net, trades: list.length }));
  return {
    trades: s.trades,
    days: byDay.size,
    net: s.net,
    capital,
    winRate: s.winRate,
    plRatio: s.plRatio,
    profitFactor: s.profitFactor,
    expectancy: s.expectancy,
    avgR: s.avgR,
    maxDrawdown: s.maxDrawdown,
    bestStreak: s.bestStreak,
    worstStreak: s.worstStreak,
    avgWinHoldMin: s.avgWinHoldMin,
    avgLossHoldMin: s.avgLossHoldMin,
    largestWin: s.largestWin,
    largestLoss: s.largestLoss,
    withStopPct: trades.length ? (trades.filter((t) => t.r !== undefined).length / trades.length) * 100 : 0,
    bestHour: hours.length ? pick(byNet(hours)[0]) : undefined,
    worstHour: hours.length > 1 ? pick(byNet(hours)[hours.length - 1]) : undefined,
    bestSetup: setups.length ? pickSetup(byNet(setups)[0]) : undefined,
    worstSetup: setups.length > 1 ? pickSetup(byNet(setups)[setups.length - 1]) : undefined,
    lastWeek: lw ? { week: lw.week, net: lw.net, trades: lw.trades, winRate: lw.winRate, plRatio: lw.plRatio, score: lw.score.total } : undefined,
    lastDays,
  };
}

function pick(b: { label: string; net: number; trades: number }) {
  return { label: b.label, net: b.net, trades: b.trades };
}

function pickSetup(b: { label: string; net: number; trades: number; winRate: number }) {
  return { label: b.label, net: b.net, trades: b.trades, winRate: b.winRate };
}

/** El análisis redactado con reglas: lo mismo que se le pide a la IA, sin IA. */
export function narrative(f: ReviewFacts): string[] {
  if (f.trades === 0) return ['Todavía no hay trades cerrados. Cuando operes unos días, acá vas a tener un análisis de cómo te está yendo.'];
  const out: string[] = [];
  const ratio = Number.isFinite(f.plRatio) ? `${f.plRatio.toFixed(2)} a 1` : 'sin pérdidas todavía';
  const sign = f.net > 0 ? 'ganancia' : f.net < 0 ? 'pérdida' : 'resultado neutro';
  let p1 = `En ${f.trades} trade${f.trades === 1 ? '' : 's'}${f.days ? ` a lo largo de ${f.days} día${f.days === 1 ? '' : 's'}` : ''} llevás una ${sign} de ${money(f.net)} sobre ${money(f.capital)} puestos en la cuenta (${((f.net / Math.max(1, f.capital)) * 100).toFixed(1)} %). `;
  if (f.trades < 5) {
    p1 += 'Son pocos trades para sacar conclusiones: lo importante por ahora es que cada entrada tenga un plan (stop y objetivo) y que lo respetes.';
    out.push(p1);
    return out;
  }
  p1 += `Acertás el ${pct(f.winRate)} de las veces y tu ganancia promedio contra tu pérdida promedio es ${ratio}. `;
  if (f.winRate >= 50 && f.plRatio >= 1.5) p1 += 'Esa combinación es la que busca un trader de momentum: con aciertos por encima de la mitad y ganancias más grandes que las pérdidas, la cuenta crece aunque haya rachas malas.';
  else if (f.winRate >= 50 && f.plRatio < 1) p1 += 'Acertás seguido pero cuando perdés, perdés más de lo que ganás: el problema no es la lectura del mercado sino la salida. Cortá antes las perdedoras y dejá correr las ganadoras hasta el objetivo.';
  else if (f.winRate < 40 && f.plRatio >= 2) p1 += 'Acertás poco pero las ganadoras son grandes: es un estilo válido, siempre que aguantes las rachas de pérdidas chicas sin agrandar el tamaño para "recuperar".';
  else if (f.winRate < 40) p1 += 'Acertás menos del 40 % y las ganadoras no compensan: conviene operar menos y elegir solo los setups más claros (4 o 5 pilares, con volumen y noticia).';
  else p1 += 'Los números están en una zona intermedia: la mejora más rápida suele venir de mejorar la relación ganancia/pérdida, no de acertar más.';
  out.push(p1);

  const p2: string[] = [];
  if (f.avgR !== undefined) p2.push(`En promedio cada trade te rinde ${f.avgR >= 0 ? '+' : ''}${f.avgR.toFixed(2)} R (lo que arriesgás hasta el stop).`);
  if (f.withStopPct < 60) p2.push(`Solo el ${pct(f.withStopPct)} de tus trades tenía stop al entrar: sin stop no se puede medir el riesgo ni mantener el tamaño bajo control.`);
  if (f.avgLossHoldMin > f.avgWinHoldMin * 1.5 && f.avgLossHoldMin > 2) p2.push(`Las perdedoras las sostenés más tiempo (${f.avgLossHoldMin.toFixed(1)} min) que las ganadoras (${f.avgWinHoldMin.toFixed(1)} min): es la señal clásica de esperar a que "vuelva".`);
  if (f.maxDrawdown > 0 && f.capital > 0 && f.maxDrawdown / f.capital > 0.1) p2.push(`Tu peor caída desde un máximo fue de ${money(f.maxDrawdown)} (${pct((f.maxDrawdown / f.capital) * 100)} de la cuenta): bajá el tamaño después de dos pérdidas seguidas.`);
  if (f.worstStreak >= 4) p2.push(`Tuviste ${f.worstStreak} pérdidas seguidas: una regla de pérdida máxima diaria te habría sacado antes.`);
  if (f.largestLoss < 0 && Math.abs(f.largestLoss) > Math.abs(f.net) && f.net > 0) p2.push(`Tu peor trade (${money(f.largestLoss)}) se llevó más que todo lo que llevás ganado: un solo trade sin stop puede borrar semanas.`);
  if (p2.length) out.push(p2.join(' '));

  // Horarios y setups: cada par va en una oración ("... y ..."), sin conjunciones sueltas.
  const hours: string[] = [];
  if (f.bestHour && f.bestHour.net > 0) hours.push(`Tu mejor horario es ${f.bestHour.label} (${money(f.bestHour.net)} en ${f.bestHour.trades} trades)`);
  if (f.worstHour && f.worstHour.net < 0) hours.push(`${hours.length ? 'el que más te cuesta' : 'El horario que más te cuesta'} es ${f.worstHour.label} (${money(f.worstHour.net)})`);
  const setups: string[] = [];
  if (f.bestSetup && f.bestSetup.net > 0) setups.push(`Con ${f.bestSetup.label} te va mejor (${money(f.bestSetup.net)}, ${pct(f.bestSetup.winRate)} de aciertos)`);
  if (f.worstSetup && f.worstSetup.net < 0) setups.push(`${setups.length ? '' : 'Con '}${f.worstSetup.label} te está costando (${money(f.worstSetup.net)}): operalo menos hasta que los números cambien`);
  const p3 = [hours, setups].filter((x) => x.length).map((x) => `${x.join(' y ')}.`);
  if (p3.length) out.push(p3.join(' '));

  if (f.lastDays.length >= 3) {
    const pos = f.lastDays.filter((d) => d.net > 0).length;
    const last = f.lastDays[f.lastDays.length - 1];
    out.push(
      `De tus últimos ${f.lastDays.length} días, ${pos} terminaron en positivo. El último (día ${last.day}) cerró en ${money(last.net)} con ${last.trades} trade${last.trades === 1 ? '' : 's'}.${f.lastWeek ? ` En la Profit Trifecta de la semana ${f.lastWeek.week} tenés ${f.lastWeek.score} de 18 puntos.` : ''}`,
    );
  }
  return out;
}

/** Lo que se le pide a la IA: un análisis corto, concreto y en español rioplatense. */
export function reviewPrompt(f: ReviewFacts): string {
  const facts = JSON.stringify(f, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
  return (
    'Sos un entrenador de day trading de momentum en small caps (estilo Ross Cameron: stop definido, relación 2:1, ' +
    'cortar perdedoras rápido, tamaño por riesgo, pérdida máxima diaria). Estos son los números de la cuenta de práctica ' +
    `de un alumno (dinero ficticio), en JSON: ${facts}\n\n` +
    'Escribí un análisis de cómo le está yendo, en español rioplatense (voseo), en dos o tres párrafos cortos y sin títulos ' +
    'ni listas: qué está haciendo bien, cuál es el problema principal con números concretos y una sola cosa para cambiar ' +
    'esta semana. Hablale directo ("vos"), sin elogios vacíos ni advertencias legales. Los montos van con $ y dos decimales; ' +
    'las horas son de Nueva York.'
  );
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}
type Sample = (input: string) => Promise<{ text: string }>;

/** La IA de Claude, si la página corre dentro de Claude (si no, null). */
export async function claudeSampler(): Promise<Sample | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return null;
  try {
    return ((await claude.use('sample')) as Sample | null) ?? null;
  } catch {
    return null;
  }
}
