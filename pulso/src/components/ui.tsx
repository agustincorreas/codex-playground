import { useEffect, useState, type ReactNode } from 'react';
import type { Lesson } from '../engine/types';
import { useStore } from '../store/useStore';
import { navigate } from '../router';
import { INSTRUMENT_META } from '../engine/instruments';
import { useT } from '../i18n';
import { lessonDurationSec } from '../content';

export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span className="stars" style={{ fontSize: size }} aria-label={`${n} estrellas`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? '' : 'off'}>★</span>
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
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--bg-3)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset .5s' }} />
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

export function Waveform({ seed, n = 24 }: { seed: string; n?: number }) {
  const rnd = hashSeed(seed);
  return (
    <div className="waveform">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ height: `${25 + rnd() * 75}%` }} />
      ))}
    </div>
  );
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
      <div className="lesson-art" style={{ background: `linear-gradient(135deg, ${lesson.art}, ${meta.accent})`, height: compact ? 84 : 110 }}>
        <div className="art-badge"><Waveform seed={lesson.id} n={compact ? 16 : 24} /></div>
        {locked && <span className="lock">🔒 {t('common.premium')}</span>}
        {!locked && progress && progress.bestStars >= 2 && <span className="lock">💿</span>}
      </div>
      <div className="lesson-body">
        <div className="lesson-title">{lesson.title}</div>
        <div className="tiny">{lesson.artist}</div>
        <div className="lesson-meta">
          <span>{meta.emoji}</span>
          <span>{t('common.grade', { n: lesson.grade })}</span>
          <span>·</span>
          <span>{lesson.bpm} BPM</span>
          <span>·</span>
          <span>{fmtDuration(lessonDurationSec(lesson))}</span>
        </div>
        <div className="row between">
          <Stars n={progress?.bestStars ?? 0} />
          {progress && <span className="tiny">{progress.bestScore}%</span>}
        </div>
      </div>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card muted" style={{ textAlign: 'center', padding: 32 }}>{children}</div>;
}
