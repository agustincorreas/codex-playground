// Las "indicaciones" del trader para la IA: lo que escribís en castellano en el panel del IA Trader
// ("si XYZ supera 4,50 me interesa comprar", "no operes ABC hoy", "hoy solo bull flags", "después de
// las 11 no entres", "máximo 3 trades"). Acá están el modelo, un intérprete simple para los casos
// comunes (Claude, si hay, las lee mejor), la ficha que se muestra, el bloque que va en cada prompt y
// las funciones puras que aplican las reglas sobre el libro de jugadas.
import { entryLabel, type EntryKind, type PlaybookRules } from './playbook';

export type InstructionRule =
  | { kind: 'level'; sym: string; price: number; side: 'above' }
  | { kind: 'avoid'; sym: string }
  | { kind: 'watch'; sym: string }
  | { kind: 'setups'; only: EntryKind[] }
  | { kind: 'noSetups'; skip: EntryKind[] }
  | { kind: 'window'; from?: number; to?: number }
  | { kind: 'maxTrades'; n: number }
  | { kind: 'note' };

export interface Instruction {
  id: string;
  /** Lo que escribió el trader, tal cual. */
  text: string;
  createdAt: number;
  /** Sobrevive al cambio de día (las demás se borran con el día). */
  permanent: boolean;
  rule: InstructionRule;
  /** Quién la interpretó: Claude o el intérprete simple. */
  by?: 'claude' | 'reglas';
  /** Ya se cumplió (un nivel que disparó su entrada): se muestra tachada y no vuelve a disparar. */
  done?: boolean;
}

export const ALL_KINDS: readonly EntryKind[] = ['bullFlag', 'microPullback', 'newHigh', 'hodBreak', 'pmhBreak', 'level'];

/** Palabras en mayúsculas que no son símbolos. */
const NOT_SYMBOLS = new Set(['NO', 'SI', 'HOY', 'IA', 'VWAP', 'EMA', 'HOD', 'LOD', 'PMH', 'PM', 'AH', 'NY', 'ET', 'USD', 'US', 'PDT', 'RVOL', 'MACD', 'OK', 'R', 'N', 'HH', 'MM', 'ATH', 'L2', 'AM', 'MAX', 'MIN', 'TOP', 'BID', 'ASK']);

/** Nombres de los setups en castellano (y en la jerga), ya sin acentos y en minúsculas. */
const SETUP_WORDS: Array<[EntryKind, RegExp]> = [
  ['pmhBreak', /pre-?\s?market|\bpmh\b/],
  ['bullFlag', /bull\s?flags?|banderin|bandera/],
  ['microPullback', /micro\s?pull\s?backs?|pullbacks?/],
  ['newHigh', /primera vela|maximo nuevo|nuevo maximo|new high/],
  ['hodBreak', /rupturas? del maximo(?!\s+(del\s+)?pre)|rompe el maximo(?!\s+(del\s+)?pre)|maximo del dia|\bhod\b|rupturas?(?! del maximo)/],
  ['level', /\bniveles?\b/],
];

const NUM_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUM = '(\\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';
const TIME = '(\\d{1,2})(?:[:.h](\\d{2}))?(?:\\s*(?:hs|h|horas))?';

/** Minúsculas y sin acentos (para buscar palabras clave). */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Los símbolos escritos en mayúsculas (1 a 5 letras; una sola letra solo con `$` o si no abre la frase). */
export function symbolsIn(text: string): string[] {
  const out: string[] = [];
  const re = /(?<![A-Za-zÁÉÍÓÚÑáéíóúñ$])(\$?)([A-Z]{1,5})(?![A-Za-zÁÉÍÓÚÑáéíóúñ])/g;
  for (const m of text.matchAll(re)) {
    const sym = m[2];
    if (NOT_SYMBOLS.has(sym)) continue;
    if (sym.length === 1 && !m[1] && m.index === 0) continue;
    if (!out.includes(sym)) out.push(sym);
  }
  return out;
}

function num(s: string): number {
  return NUM_WORDS[s] ?? Number(s);
}

function minutes(h: string, m?: string): number | undefined {
  const hh = Number(h);
  const mm = m ? Number(m) : 0;
  if (!Number.isInteger(hh) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return hh * 60 + mm;
}

function parseWindow(t: string): InstructionRule | null {
  if (!/\b(despues de|a partir de|pasadas|desde|antes de|hasta|entre|\bde)\b/.test(t)) return null;
  const neg = /\b(no|nada|ni|sin)\b/.test(t);
  let from: number | undefined;
  let to: number | undefined;
  const both = new RegExp(`(?:de|entre)\\s+(?:las?\\s+)?${TIME}\\s+(?:a|y|hasta)\\s+(?:las?\\s+)?${TIME}`).exec(t);
  if (both) {
    from = minutes(both[1], both[2]);
    to = minutes(both[3], both[4]);
  } else {
    const after = new RegExp(`(despues de|a partir de|pasadas|desde)\\s+(?:las?\\s+)?${TIME}`).exec(t);
    if (after) {
      const v = minutes(after[2], after[3]);
      if (after[1] === 'desde' || !neg) from = v;
      else to = v;
    }
    const before = new RegExp(`(antes de|hasta)\\s+(?:las?\\s+)?${TIME}`).exec(t);
    if (before) {
      const v = minutes(before[2], before[3]);
      if (before[1] === 'hasta' || !neg) to = v;
      else from = v;
    }
  }
  if (from === undefined && to === undefined) return null;
  const rule: InstructionRule = { kind: 'window' };
  if (from !== undefined) rule.from = from;
  if (to !== undefined) rule.to = to;
  return rule;
}

function parseSetups(t: string): InstructionRule | null {
  const kinds: EntryKind[] = [];
  for (const [kind, re] of SETUP_WORDS) if (re.test(t) && !kinds.includes(kind)) kinds.push(kind);
  if (!kinds.length) return null;
  if (/\b(solo|solamente|unicamente|nada mas que)\b/.test(t)) return { kind: 'setups', only: kinds };
  if (/\b(no|nada de|sin|evita|evitar|ni)\b/.test(t)) return { kind: 'noSetups', skip: kinds };
  return { kind: 'setups', only: kinds };
}

/**
 * Interpreta una indicación escrita en castellano con reglas simples (lo que no entiende es una nota
 * libre, que igual se le cuenta a Claude). Precios con coma o punto; el símbolo puede ir al principio
 * o al final.
 */
export function parseInstruction(text: string): InstructionRule {
  const t = plain(text).replace(/\s+/g, ' ').trim();
  const syms = symbolsIn(text);
  const sym = syms[0];

  // "máximo 3 trades hoy", "no más de 2 operaciones", "un solo trade".
  const trades = new RegExp(`${NUM}\\s+(?:solo\\s+|sola\\s+)?(?:trades?|operaci(?:on|ones)|entradas?|compras?)\\b`).exec(t);
  if (trades && /maximo|\bmax\b|no mas|como mucho|hasta|solo|sola|solamente|tope|limite|nada mas/.test(t)) {
    const n = num(trades[1]);
    if (n >= 1) return { kind: 'maxTrades', n };
  }

  // "si XYZ supera 4,50 me interesa comprar", "comprá ABC si rompe los $2.10".
  if (sym) {
    const lvl = /(super[ae]|romp[ae]|pas[ae]|cruc[ae]|cruza|quiebr[ae]|arriba de|por encima de|encima de|mas de)\s+(?:de\s+)?(?:los?\s+|las?\s+|el\s+)?\$?\s*(\d+(?:[.,]\d+)?)/.exec(t);
    if (lvl) {
      const price = Number(lvl[2].replace(',', '.'));
      if (price > 0) return { kind: 'level', sym, price, side: 'above' };
    }
  }

  // "hoy solo bull flags y rupturas del máximo", "nada de micro pullbacks".
  const setups = parseSetups(t);
  if (setups) return setups;

  if (sym) {
    if (/no (?:la |lo |le )?(?:oper|toqu|entr|compr|mir|sig)|evit[ae]|nada de|ni la mires|dej[ae]la|olvid|fuera\b|descart|prohib|sacala|sac[ae]\b/.test(t)) return { kind: 'avoid', sym };
    if (/mir[ae]|segu[ie]|agreg[ae]|fijate|\bojo\b|vigil|atencion|ten[ee] en cuenta|sum[ae]|anot[ae]|inclu|observ|pon[ee]/.test(t) || syms.length === 1 && t.split(' ').length <= 2) return { kind: 'watch', sym };
  }

  // "después de las 11 no entres", "solo de 9:30 a 10:30", "hasta las 11".
  const window = parseWindow(t);
  if (window) return window;

  return { kind: 'note' };
}

/** Lee una regla que vino como JSON (de Claude) y la deja válida, o null si no sirve. */
export function sanitizeRule(raw: unknown): InstructionRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sym = typeof r.sym === 'string' ? r.sym.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) : '';
  const kinds = (v: unknown): EntryKind[] => (Array.isArray(v) ? (v.filter((k): k is EntryKind => typeof k === 'string' && (ALL_KINDS as readonly string[]).includes(k)) as EntryKind[]) : []);
  const mins = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24 * 60) return Math.round(v);
    if (typeof v === 'string') {
      const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(v.trim());
      if (m) return minutes(m[1], m[2]);
    }
    return undefined;
  };
  switch (r.kind) {
    case 'level': {
      const price = typeof r.price === 'number' ? r.price : Number(String(r.price ?? '').replace(',', '.'));
      if (!sym || !(price > 0)) return null;
      return { kind: 'level', sym, price, side: 'above' };
    }
    case 'avoid':
      return sym ? { kind: 'avoid', sym } : null;
    case 'watch':
      return sym ? { kind: 'watch', sym } : null;
    case 'setups': {
      const only = kinds(r.only);
      return only.length ? { kind: 'setups', only } : null;
    }
    case 'noSetups': {
      const skip = kinds(r.skip);
      return skip.length ? { kind: 'noSetups', skip } : null;
    }
    case 'window': {
      const from = mins(r.from);
      const to = mins(r.to);
      if (from === undefined && to === undefined) return null;
      const rule: InstructionRule = { kind: 'window' };
      if (from !== undefined) rule.from = from;
      if (to !== undefined) rule.to = to;
      return rule;
    }
    case 'maxTrades': {
      const n = Number(r.n);
      return Number.isInteger(n) && n >= 1 ? { kind: 'maxTrades', n } : null;
    }
    case 'note':
      return { kind: 'note' };
    default:
      return null;
  }
}

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
/** Precio como lo escribe el trader: con coma. */
export const fmtLevel = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4)).replace('.', ',');
const list = (ks: EntryKind[]) => ks.map((k) => entryLabel(k).toLowerCase()).join(', ');

/** La ficha: cómo se entendió la indicación ("XYZ: comprar si supera 4,50"). */
export function instructionLabel(rule: InstructionRule): string {
  switch (rule.kind) {
    case 'level':
      return `${rule.sym}: comprar si supera ${fmtLevel(rule.price)}`;
    case 'avoid':
      return `${rule.sym}: no se opera`;
    case 'watch':
      return `${rule.sym}: se sigue aunque no esté en los escáneres`;
    case 'setups':
      return `Solo ${list(rule.only)}`;
    case 'noSetups':
      return `Sin ${list(rule.skip)}`;
    case 'window':
      if (rule.from !== undefined && rule.to !== undefined) return `Entradas de ${hhmm(rule.from)} a ${hhmm(rule.to)}`;
      if (rule.to !== undefined) return `Entradas hasta las ${hhmm(rule.to)}`;
      return `Entradas desde las ${hhmm(rule.from ?? 0)}`;
    case 'maxTrades':
      return `Máximo ${rule.n} trade${rule.n === 1 ? '' : 's'} hoy`;
    case 'note':
      return 'Nota para Claude';
  }
}

/** El bloque "Indicaciones del trader" para los prompts ('' si no hay ninguna activa). */
export function instructionsToPrompt(items: Instruction[]): string {
  const active = items.filter((i) => !i.done);
  if (!active.length) return '';
  return `Indicaciones del trader (mandan sobre tus preferencias):\n${active.map((i) => `- ${i.text}${i.rule.kind === 'note' ? '' : ` [${instructionLabel(i.rule)}]`}`).join('\n')}`;
}

/** Las acciones que no se operan hoy. */
export function avoidedSyms(items: Instruction[]): Set<string> {
  const out = new Set<string>();
  for (const i of items) if (i.rule.kind === 'avoid') out.add(i.rule.sym);
  return out;
}

/** Las acciones que se siguen aunque no estén en los escáneres: las de "mirá" y las de un nivel pendiente. */
export function watchedSyms(items: Instruction[]): Set<string> {
  const out = new Set<string>();
  const avoid = avoidedSyms(items);
  for (const i of items) {
    if (i.rule.kind === 'watch' || (i.rule.kind === 'level' && !i.done)) {
      if (!avoid.has(i.rule.sym)) out.add(i.rule.sym);
    }
  }
  return out;
}

/** El nivel pendiente más bajo de una acción (el primero que se cruza), si hay. */
export function levelFor(items: Instruction[], sym: string): (Instruction & { rule: Extract<InstructionRule, { kind: 'level' }> }) | undefined {
  let best: (Instruction & { rule: Extract<InstructionRule, { kind: 'level' }> }) | undefined;
  for (const i of items) {
    if (i.rule.kind !== 'level' || i.done || i.rule.sym !== sym) continue;
    if (!best || i.rule.price < best.rule.price) best = i as typeof best;
  }
  return best;
}

/**
 * Los setups que las indicaciones dejan afuera: los de "nada de X" y, con "solo X", todos los demás.
 * Un nivel del trader no se bloquea con "solo X" (es una indicación explícita), solo con "nada de niveles".
 */
export function setupFilter(items: Instruction[]): Set<EntryKind> {
  const out = new Set<EntryKind>();
  const only: EntryKind[] = [];
  for (const i of items) {
    if (i.rule.kind === 'noSetups') for (const k of i.rule.skip) out.add(k);
    if (i.rule.kind === 'setups') only.push(...i.rule.only);
  }
  if (only.length) for (const k of ALL_KINDS) if (k !== 'level' && !only.includes(k)) out.add(k);
  return out;
}

/** Las reglas del perfil acotadas por las indicaciones: horario (intersección) y tope de trades (el menor). */
export function applyInstructions(rules: PlaybookRules, items: Instruction[]): PlaybookRules {
  let out = rules;
  for (const i of items) {
    if (i.rule.kind === 'window') {
      const from = i.rule.from !== undefined ? Math.max(out.entryFrom, i.rule.from) : out.entryFrom;
      const to = i.rule.to !== undefined ? Math.min(out.entryTo, i.rule.to) : out.entryTo;
      if (from !== out.entryFrom || to !== out.entryTo) out = { ...out, entryFrom: from, entryTo: to };
    } else if (i.rule.kind === 'maxTrades' && i.rule.n < out.maxTrades) out = { ...out, maxTrades: i.rule.n };
  }
  return out;
}
