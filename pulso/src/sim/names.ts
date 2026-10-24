// Empresas y titulares ficticios para el modo demo (no son acciones reales).

const PREFIX = [
  'Aero', 'Bio', 'Cyto', 'Nova', 'Quanta', 'Helio', 'Lumen', 'Vertex', 'Zeno', 'Orbi', 'Kyro', 'Neuro',
  'Vita', 'Astra', 'Cobal', 'Draco', 'Ember', 'Fluxa', 'Gale', 'Hydro', 'Iono', 'Jovi', 'Kinet', 'Lyra',
  'Magne', 'Nexa', 'Opti', 'Pyra', 'Quell', 'Radi', 'Sola', 'Terra', 'Ultra', 'Vexa', 'Wyre', 'Xeno',
  'Yotta', 'Zephy', 'Corva', 'Ostra', 'Pelix', 'Tauro',
];
const SUFFIX = ['gen', 'tek', 'mira', 'nix', 'vant', 'lytics', 'core', 'path', 'cell', 'dyne', 'sphere', 'logic', 'nova', 'rix', 'via'];
const KIND = [
  'Therapeutics', 'Biosciences', 'Holdings', 'Energy', 'Robotics', 'AI Corp', 'Mining', 'Pharma',
  'Technologies', 'Medical', 'Networks', 'Quantum Inc', 'Logistics', 'Aerospace', 'Genomics', 'Solar',
];

export interface FakeCompany {
  sym: string;
  name: string;
  kind: string;
  exchange: string;
}

export function makeCompanies(count: number, rnd: () => number): FakeCompany[] {
  const used = new Set<string>();
  const out: FakeCompany[] = [];
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  let guard = 0;
  while (out.length < count && guard++ < count * 50) {
    const pre = pick(PREFIX);
    const suf = pick(SUFFIX);
    const kind = pick(KIND);
    const base = (pre + suf).toUpperCase().replace(/[^A-Z]/g, '');
    const len = rnd() < 0.8 ? 4 : 3;
    let sym = base[0];
    const pool = base.slice(1) + kind.toUpperCase().replace(/[^A-Z]/g, '');
    while (sym.length < len) sym += pool[Math.floor(rnd() * pool.length)];
    if (used.has(sym)) continue;
    used.add(sym);
    out.push({
      sym,
      name: `${pre}${suf} ${kind}`,
      kind,
      exchange: rnd() < 0.8 ? 'NASDAQ' : rnd() < 0.5 ? 'NYSE American' : 'NYSE',
    });
  }
  return out;
}

const BULLISH = [
  (n: string, r: () => number) => `${n} Announces FDA Fast Track Designation for ${code(r)}`,
  (n: string, r: () => number) => `${n} Receives FDA 510(k) Clearance for Next-Generation Device`,
  (n: string, r: () => number) => `${n} Signs $${money(r)}M Supply Agreement with Fortune 500 Partner`,
  (n: string) => `${n} Announces Strategic Partnership to Deploy Its AI Platform`,
  (n: string, r: () => number) => `${n} Reports Positive Phase 2 Topline Results for ${code(r)}`,
  (n: string, r: () => number) => `${n} Awarded $${money(r)}M Department of Defense Contract`,
  (n: string, r: () => number) => `${n} Reports Record Quarterly Revenue, Up ${Math.round(40 + r() * 260)}% Year-over-Year`,
  (n: string) => `${n} Enters Definitive Merger Agreement at Significant Premium`,
  (n: string, r: () => number) => `${n} Announces $${money(r)}M Share Repurchase Program`,
  (n: string) => `${n} Secures Exclusive Licensing Deal for Breakthrough Battery Technology`,
];
const BEARISH = [
  (n: string, r: () => number) => `${n} Announces $${money(r)}M Registered Direct Offering`,
  (n: string) => `${n} Prices Underwritten Public Offering of Common Stock and Warrants`,
  (n: string, r: () => number) => `${n} Announces 1-for-${[10, 15, 20, 25][Math.floor(r() * 4)]} Reverse Stock Split`,
  (n: string) => `${n} Receives Nasdaq Minimum Bid Price Deficiency Notice`,
];
const NEUTRAL = [
  (n: string) => `${n} to Present at Upcoming Investor Conference`,
  (n: string) => `${n} Appoints New Chief Financial Officer`,
  (n: string) => `${n} Schedules Quarterly Earnings Conference Call`,
  (n: string) => `${n} Publishes Annual Sustainability Report`,
];

function code(r: () => number): string {
  return `${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}-${100 + Math.floor(r() * 900)}`;
}

function money(r: () => number): number {
  return Math.round(5 + r() * 145);
}

export function headline(name: string, sentiment: 'bullish' | 'bearish' | 'neutral', rnd: () => number): string {
  const pool = sentiment === 'bullish' ? BULLISH : sentiment === 'bearish' ? BEARISH : NEUTRAL;
  return pool[Math.floor(rnd() * pool.length)](name, rnd);
}

export const NEWS_SOURCES = ['GlobeNewswire', 'PR Newswire', 'Business Wire', 'ACCESSWIRE', 'Benzinga'];
