// Halts desde el RSS público de Nasdaq Trader (gratis, cubre NASDAQ, NYSE y AMEX).
// Nasdaq pide no consultarlo más de una vez por minuto.
import type { Engine } from '../src/engine/engine';
import type { MarketEvent } from '../src/engine/types';
import { etDateTimeToTs } from '../src/engine/time';
import { getText, type Log } from './util';

export const HALTS_RSS_URL = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';

export interface RssHalt {
  symbol: string;
  name: string;
  market: string;
  reason: string;
  haltDate: string;
  haltTime: string;
  resumptionDate: string;
  resumptionQuoteTime: string;
  resumptionTradeTime: string;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function parseHaltsRss(xml: string): RssHalt[] {
  const out: RssHalt[] = [];
  for (const chunk of xml.replace(/^﻿/, '').split('<item>').slice(1)) {
    const item = chunk.split('</item>')[0];
    const field = (name: string) => {
      const m = item.match(new RegExp(`<ndaq:${name}>([\\s\\S]*?)</ndaq:${name}>`));
      return m ? decode(m[1]) : '';
    };
    const symbol = field('IssueSymbol');
    if (!symbol) continue;
    out.push({
      symbol,
      name: field('IssueName'),
      market: field('Market'),
      reason: field('ReasonCode'),
      haltDate: field('HaltDate'),
      haltTime: field('HaltTime'),
      resumptionDate: field('ResumptionDate'),
      resumptionQuoteTime: field('ResumptionQuoteTime'),
      resumptionTradeTime: field('ResumptionTradeTime'),
    });
  }
  return out;
}

/** "10/23/2026" → "2026-10-23". */
export function mdyToKey(mdy: string): string {
  const m = mdy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}

/** Convierte los halts de la sesión en eventos de estado (halt y, si ya ocurrió, reanudación). */
export function haltEvents(halts: RssHalt[], sessionKey: string, now: number): Array<Extract<MarketEvent, { kind: 'status' }>> {
  const events: Array<Extract<MarketEvent, { kind: 'status' }>> = [];
  for (const h of halts) {
    const haltKey = mdyToKey(h.haltDate);
    const resKey = mdyToKey(h.resumptionDate);
    if (haltKey !== sessionKey && resKey !== sessionKey) continue;
    if (!haltKey || !h.haltTime) continue;
    const haltTs = etDateTimeToTs(haltKey, h.haltTime);
    const resumeTs = resKey && h.resumptionTradeTime ? etDateTimeToTs(resKey, h.resumptionTradeTime) : undefined;
    // El código cambia durante la vida del halt (T1 → T3 al anunciar la reanudación): se usa el original.
    const reason = h.reason === 'T3' ? 'T1' : h.reason;
    events.push({ kind: 'status', sym: h.symbol, ts: haltTs, halted: true, reason, resumeTs, source: 'nasdaq' });
    if (resumeTs && resumeTs <= now) {
      events.push({ kind: 'status', sym: h.symbol, ts: resumeTs, halted: false, reason, source: 'nasdaq' });
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

export class HaltsPoller {
  private timer?: ReturnType<typeof setInterval>;
  private seen = new Set<string>();
  private first = true;

  constructor(
    private readonly engine: () => Engine,
    private readonly sessionKey: () => string,
    private readonly log: Log,
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 61_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    let xml: string;
    try {
      xml = await getText(HALTS_RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Pulso momentum scanner)' } });
    } catch (e) {
      this.log('warn', `Halts de Nasdaq: ${(e as Error).message}`);
      return;
    }
    const engine = this.engine();
    const events = haltEvents(parseHaltsRss(xml), this.sessionKey(), Date.now());
    // Los halts que ya habían ocurrido al arrancar se cargan como historial (sin sonido).
    engine.warmup = this.first;
    let fresh = 0;
    for (const ev of events) {
      const sym = resolveSymbol(engine, ev.sym);
      if (!sym) continue;
      const key = `${sym}|${ev.ts}|${ev.halted ? 'H' : 'R'}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      engine.ingest({ ...ev, sym });
      fresh++;
    }
    engine.warmup = false;
    if (this.first) this.log('info', `Halts de Nasdaq: ${fresh} eventos de la sesión cargados.`);
    this.first = false;
  }
}

/** Nasdaq usa "BRK.B" o "AHT-F"; el proveedor puede usar otra variante. */
export function resolveSymbol(engine: Engine, raw: string): string | null {
  const s = raw.trim().toUpperCase();
  for (const cand of [s, s.replace(/-/g, '.'), s.replace(/\./g, '-'), s.replace(/[.-]/g, '')]) {
    if (engine.get(cand)) return cand;
  }
  return null;
}
