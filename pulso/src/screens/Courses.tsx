import { COURSES, getCourse, getLesson } from '../content';
import { useStore } from '../store/useStore';
import { navigate, back } from '../router';
import { useT } from '../i18n';
import type { Course } from '../engine/types';
import { INSTRUMENT_META } from '../engine/instruments';
import { Stars, Waveform, fmtDuration } from '../components/ui';
import { lessonDurationSec } from '../content';

export function CourseCard({ course }: { course: Course }) {
  const progress = useStore((s) => s.progress);
  const t = useT();
  const done = course.lessonIds.filter((id) => (progress[id]?.bestStars ?? 0) >= 2).length;
  return (
    <button className="lesson-card" onClick={() => navigate({ name: 'course', id: course.id })}>
      <div className="lesson-art" style={{ background: `linear-gradient(135deg, ${course.art}, ${INSTRUMENT_META[course.instrument].accent})` }}>
        <div className="art-badge"><Waveform seed={course.id} n={18} /></div>
      </div>
      <div className="lesson-body">
        <div className="lesson-title">{course.title}</div>
        <div className="tiny">{course.description}</div>
        <div className="progress-bar" style={{ marginTop: 6 }}><i style={{ width: `${(done / course.lessonIds.length) * 100}%` }} /></div>
        <div className="tiny">{t('course.progress', { done, total: course.lessonIds.length })}</div>
      </div>
    </button>
  );
}

export function Courses() {
  const t = useT();
  const instrument = useStore((s) => s.instrument);
  const setInstrument = useStore((s) => s.setInstrument);
  const list = COURSES.filter((c) => c.instrument === instrument).sort((a, b) => a.grade - b.grade);
  return (
    <div className="fade-up col" style={{ gap: 14 }}>
      <div className="row between wrap">
        <h1>{t('nav.courses')}</h1>
        <div className="segmented">
          {(['keys', 'pads', 'drums'] as const).map((i) => (
            <button key={i} className={instrument === i ? 'active' : ''} onClick={() => setInstrument(i)}>{INSTRUMENT_META[i].emoji}</button>
          ))}
        </div>
      </div>
      <div className="grid">{list.map((c) => <CourseCard key={c.id} course={c} />)}</div>
    </div>
  );
}

export function CourseDetail({ id }: { id: string }) {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const premium = useStore((s) => s.premium);
  const course = getCourse(id);
  if (!course) return <div className="card">404</div>;
  const lessons = course.lessonIds.map(getLesson).filter(Boolean);
  const done = lessons.filter((l) => (progress[l!.id]?.bestStars ?? 0) >= 2).length;
  const next = lessons.find((l) => (progress[l!.id]?.bestStars ?? 0) < 2) ?? lessons[0];
  return (
    <div className="fade-up col" style={{ gap: 16 }}>
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={back}>← {t('nav.courses')}</button>
      <div className="card" style={{ background: `linear-gradient(120deg, ${course.art}44, var(--card))` }}>
        <div className="tiny">{INSTRUMENT_META[course.instrument].emoji} {INSTRUMENT_META[course.instrument].label} · {t('course.lessons', { n: lessons.length })}</div>
        <h1>{course.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{course.description}</p>
        <div className="progress-bar" style={{ marginTop: 14 }}><i style={{ width: `${(done / lessons.length) * 100}%` }} /></div>
        <div className="row between" style={{ marginTop: 12 }}>
          <span className="tiny">{t('course.progress', { done, total: lessons.length })}</span>
          {next && <button className="btn primary" onClick={() => navigate({ name: 'lesson', id: next.id })}>{done ? t('course.continue') : t('course.start')}</button>}
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {lessons.map((l, i) => {
          const p = progress[l!.id];
          const locked = !l!.free && !premium;
          return (
            <button key={l!.id} className="card row between" style={{ padding: 14, textAlign: 'left' }} onClick={() => navigate({ name: 'lesson', id: l!.id })}>
              <div className="row">
                <div style={{ width: 36, height: 36, borderRadius: 10, background: p && p.bestStars >= 2 ? 'var(--green)' : 'var(--bg-3)', display: 'grid', placeItems: 'center', fontWeight: 800, color: p && p.bestStars >= 2 ? '#04261a' : 'inherit' }}>{p && p.bestStars >= 2 ? '✓' : i + 1}</div>
                <div>
                  <div style={{ fontWeight: 700 }}>{l!.title} {locked && '🔒'}</div>
                  <div className="tiny">{t('common.grade', { n: l!.grade })} · {l!.bpm} BPM · {fmtDuration(lessonDurationSec(l!))}</div>
                </div>
              </div>
              <Stars n={p?.bestStars ?? 0} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
