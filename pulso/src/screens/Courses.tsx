import { COURSES, getCourse, getLesson } from '../content';
import { useStore } from '../store/useStore';
import { navigate, back } from '../router';
import { useT } from '../i18n';
import type { Course } from '../engine/types';
import { INSTRUMENT_META } from '../engine/instruments';
import { Stars, Art, fmtDuration } from '../components/ui';
import { Icon, INSTRUMENT_ICON } from '../components/Icon';
import { lessonDurationSec } from '../content';

export function CourseCard({ course }: { course: Course }) {
  const progress = useStore((s) => s.progress);
  const t = useT();
  const done = course.lessonIds.filter((id) => (progress[id]?.bestStars ?? 0) >= 2).length;
  return (
    <button className="lesson-card" onClick={() => navigate({ name: 'course', id: course.id })}>
      <div className="lesson-art">
        <Art seed={course.id} color={course.art} accent={INSTRUMENT_META[course.instrument].accent} />
        <span className="grade">{t('course.lessons', { n: course.lessonIds.length }).toUpperCase()}</span>
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
            <button key={i} className={instrument === i ? 'active' : ''} onClick={() => setInstrument(i)} title={INSTRUMENT_META[i].label}><Icon name={INSTRUMENT_ICON[i]} size={16} /></button>
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
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginLeft: -12 }} onClick={back}><Icon name="back" size={16} /> {t('nav.courses')}</button>
      <div className="card elev" style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-xl)', padding: 26 }}>
        <div style={{ position: 'absolute', inset: 0, opacity: .55 }}><Art seed={course.id} color={course.art} accent={INSTRUMENT_META[course.instrument].accent} /></div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, var(--bg-elev) 30%, transparent)' }} />
        <div style={{ position: 'relative' }}>
        <div className="eyebrow row" style={{ gap: 6 }}><Icon name={INSTRUMENT_ICON[course.instrument]} size={14} /> {INSTRUMENT_META[course.instrument].label} · {t('course.lessons', { n: lessons.length })}</div>
        <h1>{course.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{course.description}</p>
        <div className="progress-bar" style={{ marginTop: 14 }}><i style={{ width: `${(done / lessons.length) * 100}%` }} /></div>
        <div className="row between" style={{ marginTop: 12 }}>
          <span className="tiny">{t('course.progress', { done, total: lessons.length })}</span>
          {next && <button className="btn primary" onClick={() => navigate({ name: 'lesson', id: next.id })}>{done ? t('course.continue') : t('course.start')}</button>}
        </div>
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {lessons.map((l, i) => {
          const p = progress[l!.id];
          const locked = !l!.free && !premium;
          return (
            <button key={l!.id} className="card row between" style={{ padding: 14, textAlign: 'left' }} onClick={() => navigate({ name: 'lesson', id: l!.id })}>
              <div className="row">
                <div className="num" style={{ width: 38, height: 38, borderRadius: 12, background: p && p.bestStars >= 2 ? 'var(--green)' : 'var(--surface-2)', display: 'grid', placeItems: 'center', fontWeight: 600, color: p && p.bestStars >= 2 ? '#04261a' : 'inherit' }}>{p && p.bestStars >= 2 ? <Icon name="check" size={18} strokeWidth={2.4} /> : i + 1}</div>
                <div>
                  <div className="row" style={{ fontWeight: 600, gap: 6 }}>{l!.title} {locked && <Icon name="lock" size={13} style={{ color: 'var(--text-3)' }} />}</div>
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
