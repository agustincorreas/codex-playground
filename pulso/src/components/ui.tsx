import { useEffect, useState, type ReactNode } from 'react';
import type { Instrument, Lesson } from '../engine/types';
import { useStore } from '../store/useStore';
import { navigate } from '../router';
import { INSTRUMENT_META } from '../engine/instruments';
import { useT } from '../i18n';
import { lessonDurationSec } from '../content';
import { Icon, INSTRUMENT_ICON } from './Icon';

export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${n} estrellas`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? '' : 'off'} style={{ display: 'inline-flex' }}><Icon name="star" size={size} /></span>
      ))}
    </span>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />;
}

export function Ring({ value, size = 96, stroke = 9, color = 'var(--accent)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal fade-up" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 2600);
    return () => window.clearTimeout(t);
  }, [msg]);
  return { msg, show: setMsg };
}

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Arte abstracto y sutil para una lección: gradiente profundo con formas suaves que varían por semilla. */
export function Art({ seed, color, accent }: { seed: string; color: string; accent: string }) {
  const rnd = hashSeed(seed);
  const id = `g-${seed.replace(/[^a-z0-9]/gi, '')}`;
  const variant = Math.floor(rnd() * 4);
  const cx1 = 15 + rnd() * 70;
  const cy1 = 10 + rnd() * 45;
  const cx2 = 15 + rnd() * 70;
  const cy2 = 15 + rnd() * 45;
  const r1 = 26 + rnd() * 24;
  const r2 = 14 + rnd() * 18;
  const angle = -30 + rnd() * 60;
  const rings = 3 + Math.floor(rnd() * 4);
  const bars = 5 + Math.floor(rnd() * 6);
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`${id}-a`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={color} stopOpacity="0.7" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-b`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <rect width="100" height="60" fill="#0e0e12" />
      <rect width="100" height="60" fill={`url(#${id}-bg)`} />
      <circle cx={cx1} cy={cy1} r={r1} fill={`url(#${id}-a)`} />
      <circle cx={cx2} cy={cy2} r={r2} fill={`url(#${id}-b)`} />
      {variant === 0 && Array.from({ length: rings }, (_, i) => (
        <circle key={i} cx={cx1} cy={cy1} r={5 + i * 6.5} fill="none" stroke="#fff" strokeOpacity={0.1 - i * 0.012} strokeWidth="0.5" />
      ))}
      {variant === 1 && (
        <g transform={`rotate(${angle} 50 30)`}>
          {Array.from({ length: bars }, (_, i) => (
            <rect key={i} x={-20 + i * (140 / bars)} y="-20" width={140 / bars / 2.4} height="100" fill="#fff" fillOpacity={0.03 + (i % 3) * 0.015} />
          ))}
        </g>
      )}
      {variant === 2 && Array.from({ length: 4 }, (_, i) => (
        <path key={i} d={`M ${-10 + i * 6} 70 Q ${cx1} ${cy1 - 30 + i * 10} 115 ${10 + i * 8}`} fill="none" stroke="#fff" strokeOpacity={0.09 - i * 0.015} strokeWidth="0.7" />
      ))}
      {variant === 3 && Array.from({ length: 6 }, (_, i) => (
        <circle key={i} cx={12 + i * 15} cy={30 + Math.sin(i * 1.3 + cx1) * 12} r={1.4 + (i % 3)} fill="#fff" fillOpacity={0.14} />
      ))}
      <rect width="100" height="60" fill={`url(#${id}-shade)`} />
    </svg>
  );
}

export function InstrumentIcon({ instrument, size = 16 }: { instrument: Instrument; size?: number }) {
  return <Icon name={INSTRUMENT_ICON[instrument]} size={size} />;
}

export function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function LessonCard({ lesson, compact }: { lesson: Lesson; compact?: boolean }) {
  const progress = useStore((s) => s.progress[lesson.id]);
  const premium = useStore((s) => s.premium);
  const t = useT();
  const locked = !lesson.free && !premium;
  const meta = INSTRUMENT_META[lesson.instrument];
  return (
    <button className="lesson-card" onClick={() => navigate({ name: 'lesson', id: lesson.id })}>
      <div className="lesson-art" style={{ height: compact ? 88 : 118 }}>
        <Art seed={lesson.id} color={lesson.art} accent={meta.accent} />
        <span className="grade">{t('common.grade', { n: lesson.grade }).toUpperCase()}</span>
        {locked && <span className="lock"><Icon name="lock" size={12} /> {t('common.premium')}</span>}
        {!locked && progress && progress.bestStars >= 2 && <span className="lock"><Icon name="disc" size={12} /></span>}
      </div>
      <div className="lesson-body">
        <div className="lesson-title">{lesson.title}</div>
        <div className="tiny">{lesson.artist}</div>
        <div className="lesson-meta">
          <InstrumentIcon instrument={lesson.instrument} size={13} />
          <span>{lesson.bpm} BPM</span>
          <span>·</span>
          <span>{fmtDuration(lessonDurationSec(lesson))}</span>
        </div>
        <div className="row between" style={{ marginTop: 4 }}>
          <Stars n={progress?.bestStars ?? 0} />
          {progress && <span className="tiny num">{progress.bestScore}</span>}
        </div>
      </div>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card muted" style={{ textAlign: 'center', padding: 32 }}>{children}</div>;
}
