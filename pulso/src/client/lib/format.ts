import { fmtPrice, fmtVolume } from '../../engine/alerts';

export { fmtPrice, fmtVolume };

export function fmtPct(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return '—';
  const s = p.toFixed(Math.abs(p) >= 100 ? 0 : digits);
  return `${p > 0 ? '+' : ''}${s}%`;
}

export function fmtRvol(x: number): string {
  if (!(x > 0)) return '—';
  if (x >= 100) return `${Math.round(x)}x`;
  if (x >= 10) return `${x.toFixed(1)}x`;
  return `${x.toFixed(2)}x`;
}

export function fmtFloat(f?: number): string {
  if (!f) return '—';
  if (f >= 1e9) return `${(f / 1e9).toFixed(2)}B`;
  if (f >= 1e6) return `${(f / 1e6).toFixed(f >= 1e8 ? 0 : f >= 1e7 ? 1 : 2)}M`;
  return `${(f / 1e3).toFixed(0)}K`;
}

export function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function toneOf(n: number): 'up' | 'down' | 'flat' {
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
