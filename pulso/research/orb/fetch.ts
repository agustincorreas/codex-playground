// Descarga los datos reales para investigar el ORB en "acciones en juego" (Zarattini, Barbon y Aziz 2024):
//   A. universo por año: las 1.000 de mayor volumen en dólares en diciembre del año anterior, precio > $5;
//   B. velas diarias del universo (ATR de 14 días, promedio de volumen);
//   C. la primera vela de 5 min de cada día de cada acción del universo (volumen relativo al abrir);
//   D. las velas de 1 min del día entero de las 20 más "en juego" de cada día.
// Fuente: Alpaca, feed SIP histórico (viene con la clave gratis). Reanudable: lo ya bajado no se vuelve a pedir.
// Uso: npx tsx research/orb/fetch.ts [desde=2021-01-01] [hasta=2026-10-30] [universo=1000] [top=20]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), 'data');
const env = Object.fromEntries(
  readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', '..', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.ALPACA_KEY_ID;
const SECRET = env.ALPACA_SECRET_KEY;
if (!KEY || !SECRET) throw new Error('faltan ALPACA_KEY_ID / ALPACA_SECRET_KEY en pulso/.env');
const FROM = process.argv[2] ?? '2021-01-01';
const TO = process.argv[3] ?? '2026-10-30';
const UNIVERSE = Number(process.argv[4] ?? 1000);
const TOP = Number(process.argv[5] ?? 20);

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

// ---------------------------------------------------------------- cliente con límite de 190 pedidos por minuto
const times: number[] = [];
async function get(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`https://data.alpaca.markets${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    while (times.length && now - times[0] > 60_000) times.shift();
    if (times.length >= 190) await sleep(60_000 - (now - times[0]) + 50);
    times.push(Date.now());
    const res = await fetch(url, { headers: { 'APCA-API-KEY-ID': KEY, 'APCA-API-SECRET-KEY': SECRET } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()} ${url}`);
    return res.json();
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Velas de varios símbolos (paginando) entre dos instantes. */
export async function bars(symbols: string[], timeframe: string, start: string, end: string, extra: Record<string, string> = {}): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  let token: string | undefined;
  do {
    const j = await get('/v2/stocks/bars', { symbols: symbols.join(','), timeframe, start, end, feed: 'sip', limit: '10000', adjustment: 'split', ...extra, ...(token ? { page_token: token } : {}) });
    for (const [sym, list] of Object.entries(j.bars ?? {})) (out[sym] ??= []).push(...(list as Bar[]));
    token = j.next_page_token ?? undefined;
  } while (token);
  return out;
}

export const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
export const save = (file: string, data: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
};
export const loadJson = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null);

// ---------------------------------------------------------------- calendario (días con vela diaria de SPY)
export async function tradingDays(from: string, to: string): Promise<string[]> {
  const file = join(ROOT, 'days.json');
  const cached = loadJson<{ from: string; to: string; days: string[] }>(file);
  if (cached && cached.from === from && cached.to === to) return cached.days;
  const spy = await bars(['SPY'], '1Day', `${from}T00:00:00Z`, `${to}T23:59:59Z`);
  const days = (spy.SPY ?? []).map((b) => b.t.slice(0, 10));
  save(file, { from, to, days });
  return days;
}

// ---------------------------------------------------------------- A. universo por año
async function universeFor(year: number, assets: string[]): Promise<string[]> {
  const file = join(ROOT, 'universe', `${year}.v2.json`);
  const cached = loadJson<string[]>(file);
  if (cached) return cached;
  const start = `${year - 1}-12-01T00:00:00Z`;
  const end = `${year - 1}-12-31T23:59:59Z`;
  const score = new Map<string, { dv: number; px: number; n: number }>();
  const groups = chunk(assets, 200);
  for (let i = 0; i < groups.length; i++) {
    const got = await bars(groups[i], '1Day', start, end);
    for (const [sym, list] of Object.entries(got)) {
      if (list.length < 10) continue;
      const dv = list.reduce((a, b) => a + b.c * b.v, 0) / list.length;
      score.set(sym, { dv, px: list[list.length - 1].c, n: list.length });
    }
    if (i % 10 === 0) console.log(`universo ${year}: ${i + 1}/${groups.length} grupos`);
  }
  const uni = [...score.entries()]
    .filter(([, s]) => s.px >= 5)
    .sort((a, b) => b[1].dv - a[1].dv)
    .slice(0, UNIVERSE)
    .map(([sym]) => sym);
  save(file, uni);
  console.log(`universo ${year}: ${uni.length} acciones (menor volumen en dólares: ${Math.round(score.get(uni[uni.length - 1])!.dv / 1e6)} M/día)`);
  return uni;
}

// ---------------------------------------------------------------- B. velas diarias del universo
export async function dailyFor(symbols: string[], from: string, to: string): Promise<void> {
  const missing = symbols.filter((s) => !existsSync(join(ROOT, 'daily', `${s}.json`)));
  const groups = chunk(missing, 100);
  for (let i = 0; i < groups.length; i++) {
    const got = await bars(groups[i], '1Day', `${from}T00:00:00Z`, `${to}T23:59:59Z`);
    for (const sym of groups[i]) save(join(ROOT, 'daily', `${sym}.json`), got[sym] ?? []);
    if (i % 5 === 0) console.log(`diarias: ${i + 1}/${groups.length} grupos`);
  }
}

// ---------------------------------------------------------------- C. primera vela de 5 min de cada día
/** Hora de Nueva York a UTC para la fecha (horario de verano entre el 2.º domingo de marzo y el 1.º de noviembre). */
export function etOffset(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const nthSunday = (year: number, month: number, n: number) => {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const dst = (m > 3 && m < 11) || (m === 3 && d >= nthSunday(y, 3, 2)) || (m === 11 && d < nthSunday(y, 11, 1));
  return dst ? '-04:00' : '-05:00';
}

export async function openingBars(day: string, symbols: string[]): Promise<Record<string, Bar>> {
  const file = join(ROOT, 'open5', `${day}.json`);
  const cached = loadJson<Record<string, Bar>>(file) ?? {};
  const asked = loadJson<string[]>(file + '.syms') ?? Object.keys(cached);
  const missing = symbols.filter((s) => !asked.includes(s));
  if (!missing.length) return cached;
  const off = etOffset(day);
  const out: Record<string, Bar> = { ...cached };
  for (const g of chunk(missing, 250)) {
    const got = await bars(g, '5Min', `${day}T09:30:00${off}`, `${day}T09:34:59${off}`);
    for (const [sym, list] of Object.entries(got)) if (list[0]) out[sym] = list[0];
  }
  save(file, out);
  save(file + '.syms', [...new Set([...asked, ...missing])]);
  return out;
}

// ---------------------------------------------------------------- D. velas de 1 min del día de las "en juego"
export async function minuteBars(day: string, symbols: string[]): Promise<void> {
  const file = join(ROOT, 'min', `${day}.json`);
  const cached = loadJson<Record<string, Bar[]>>(file) ?? {};
  const missing = symbols.filter((s) => !(s in cached));
  if (!missing.length) return;
  const off = etOffset(day);
  const got = await bars(missing, '1Min', `${day}T09:30:00${off}`, `${day}T16:00:00${off}`);
  for (const s of missing) cached[s] = got[s] ?? [];
  save(file, cached);
}

/** ETFs, fondos y productos estructurados, por el nombre del activo. */
export function isFund(name: string): boolean {
  return /\b(ETF|ETN|Fund|Trust|iShares|Vanguard|SPDR|ProShares|Direxion|Invesco|WisdomTree|Index|Portfolio|Shares|Bitcoin|Ether|Treasury|Bond|Income|Preferred|Depositary|Warrant|Unit|Right)\b/i.test(name);
}

// ---------------------------------------------------------------- principal
async function main() {
  mkdirSync(ROOT, { recursive: true });
  const assetsFile = join(ROOT, 'assets.json');
  if (!existsSync(assetsFile)) throw new Error('falta data/assets.json (bajalo de /v2/assets)');
  // Solo acciones comunes: los ETFs y fondos quedan afuera (su volumen al abrir no es "noticia").
  const assets = (JSON.parse(readFileSync(assetsFile, 'utf8')) as Array<{ symbol: string; name: string; tradable: boolean; exchange: string }>)
    .filter((a) => a.tradable && ['NYSE', 'NASDAQ', 'ARCA', 'AMEX', 'BATS'].includes(a.exchange) && /^[A-Z]{1,5}$/.test(a.symbol) && !isFund(a.name ?? ''))
    .map((a) => a.symbol);
  console.log(`${assets.length} símbolos operables`);
  const days = await tradingDays(FROM, TO);
  console.log(`${days.length} días hábiles de ${FROM} a ${TO}`);
  const years = [...new Set(days.map((d) => Number(d.slice(0, 4))))];
  const uni: Record<number, string[]> = {};
  for (const y of years) uni[y] = await universeFor(y, assets);
  const all = [...new Set(Object.values(uni).flat())];
  console.log(`${all.length} acciones en la unión de universos`);
  await dailyFor(all, `${years[0] - 1}-11-01`, TO);
  // C y D día por día: volumen relativo = primera vela de hoy / promedio de las primeras velas de los 14 días previos.
  const history = new Map<string, number[]>();
  let done = 0;
  for (const day of days) {
    const y = Number(day.slice(0, 4));
    const open = await openingBars(day, uni[y]);
    const ranked: Array<{ sym: string; rvol: number }> = [];
    const inUni = new Set(uni[y]);
    for (const [sym, b] of Object.entries(open)) {
      if (!inUni.has(sym)) continue;
      const h = history.get(sym) ?? [];
      if (h.length >= 5) {
        const avg = h.slice(-14).reduce((a, v) => a + v, 0) / Math.min(14, h.length);
        if (avg > 0) ranked.push({ sym, rvol: b.v / avg });
      }
      h.push(b.v);
      if (h.length > 14) h.shift();
      history.set(sym, h);
    }
    ranked.sort((a, b) => b.rvol - a.rvol);
    const top = ranked.slice(0, TOP);
    save(join(ROOT, 'inplay', `${day}.json`), top);
    if (top.length) await minuteBars(day, top.map((x) => x.sym));
    if (++done % 20 === 0) console.log(`${day}: ${done}/${days.length} días; en juego: ${top.slice(0, 5).map((x) => `${x.sym} ${x.rvol.toFixed(1)}x`).join(', ')}`);
  }
  console.log('listo');
}

export const ROOT_DIR = ROOT;
export function tradableAssets(): string[] {
  const assetsFile = join(ROOT, 'assets.json');
  if (!existsSync(assetsFile)) throw new Error('falta data/assets.json (bajalo de /v2/assets)');
  return (JSON.parse(readFileSync(assetsFile, 'utf8')) as Array<{ symbol: string; name: string; tradable: boolean; exchange: string }>)
    .filter((a) => a.tradable && ['NYSE', 'NASDAQ', 'ARCA', 'AMEX', 'BATS'].includes(a.exchange) && /^[A-Z]{1,5}$/.test(a.symbol) && !isFund(a.name ?? ''))
    .map((a) => a.symbol);
}

if (process.argv[1]?.endsWith('fetch.ts'))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
