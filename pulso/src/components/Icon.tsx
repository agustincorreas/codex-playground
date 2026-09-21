// Íconos de línea, estilo SF Symbols. Trazo 1.8, esquinas redondeadas.
import type { CSSProperties } from 'react';

const PATHS: Record<string, string | { d: string; fill?: boolean }> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  note: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Zm0 15A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3m-3 0h6',
  dumbbell: 'M6 8v8M3 10v4m15-6v8m3-6v4M6 12h12',
  chart: 'M4 20V10m5.5 10V4M15 20v-7m5.5 7V8',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.2.9-.5-.9-3.1-1 .1a6 6 0 0 0-1.1-1.9l.5-.9-2.3-2.3-.9.5a6 6 0 0 0-1.9-1.1l-.1-1h-3.2l-.1 1a6 6 0 0 0-1.9 1.1l-.9-.5L4.2 6.9l.5.9A6 6 0 0 0 3.6 9.7l-1 .1v3.2l1 .1a6 6 0 0 0 1.1 1.9l-.5.9 2.3 2.3.9-.5a6 6 0 0 0 1.9 1.1l.1 1h3.2l.1-1a6 6 0 0 0 1.9-1.1l.9.5 2.3-2.3-.5-.9a6 6 0 0 0 1.1-1.9Z',
  play: { d: 'M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z', fill: true },
  pause: { d: 'M7 5h3.5v14H7zm6.5 0H17v14h-3.5z', fill: true },
  restart: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5',
  loop: 'M17 3l3 3-3 3M7 21l-3-3 3-3M20 6H9a4 4 0 0 0-4 4v1m-1 7h11a4 4 0 0 0 4-4v-1',
  metronome: 'M9 3h6l3 17H6L9 3Zm3 0v11m0 0 5-6',
  headphones: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3Zm16 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z',
  waveform: 'M3 12h2m2-5v10m3-13v16m3-11v6m3-9v12m3-7v2m2 0',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 9.5 17 19 7',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  star: { d: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.3l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8L12 2.8Z', fill: true },
  flame: 'M12 21c-4 0-7-2.8-7-6.7 0-3.3 2.4-5.4 3.6-7.8.5 1.6 1 2.5 2.1 3 .1-2.5.9-5.5 3.4-7.5 0 3.6 4.9 5.6 4.9 12.3C19 18.2 16 21 12 21Zm0 0c-1.7 0-3-1.3-3-3 0-1.8 1.6-2.4 3-4.5 1.4 2.1 3 2.7 3 4.5 0 1.7-1.3 3-3 3Z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H5v1a3 3 0 0 0 3 3m8-4h3v1a3 3 0 0 1-3 3m-4 4v4m-4 0h8',
  keys: 'M4 5h16v14H4zM8 5v9m4-9v9m4-9v9',
  pads: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  drums: 'M12 13c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Zm-8-3v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M7 7 4 3m13 4 3-4',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  hand: 'M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V11m0-3a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4.2-2.3L4 14.5a1.5 1.5 0 0 1 2.4-1.8L9 15V7.5a1.5 1.5 0 0 1 3 0',
  midi: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9h.01M9 9h.01m6 0H15m1 3h.01M12 15h.01',
  keyboard: 'M3 7h18v10H3zM6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M4 12H2m20 0h-2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 11 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z',
  disc: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  layers: 'M12 4 3 9l9 5 9-5-9-5Zm-9 9 9 5 9-5m-18 3.5 9 5 9-5',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14',
  trash: 'M5 7h14M9 7V4h6v3m-7 0v13h8V7',
};

interface Props {
  name: keyof typeof PATHS | string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, style, className }: Props) {
  const p = PATHS[name];
  if (!p) return null;
  const d = typeof p === 'string' ? p : p.d;
  const fill = typeof p === 'string' ? false : !!p.fill;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', ...style }} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const INSTRUMENT_ICON: Record<'keys' | 'pads' | 'drums', string> = { keys: 'keys', pads: 'pads', drums: 'drums' };
