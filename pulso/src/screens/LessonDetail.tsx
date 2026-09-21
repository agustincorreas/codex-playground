import { useState } from 'react';
import { getLesson, lessonDurationSec, lessonNoteCount, getCourse } from '../content';
import { useStore, freePlaysLeft, FREE_PLAYS_PER_DAY } from '../store/useStore';
import { navigate, back } from '../router';
import { useT } from '../i18n';
import { INSTRUMENT_META } from '../engine/instruments';
import { Stars, Art, fmtDuration, Modal, InstrumentIcon } from '../components/ui';
import { Icon } from '../components/Icon';

export function Paywall({ onClose, limit }: { onClose: () => void; limit?: boolean }) {
  const t = useT();
  const setPremium = useStore((s) => s.setPremium);
  return (
    <Modal onClose={onClose}>
      <div className="col" style={{ textAlign: 'center', alignItems: 'center' }}>
        <div className="icon-circle" style={{ width: 64, height: 64, borderRadius: 20, color: 'var(--gold)', background: 'rgba(255,214,10,.12)' }}><Icon name="sparkle" size={30} /></div>
        <h2>{t('paywall.title')}</h2>
        <p className="muted">{limit ? t('paywall.limit', { n: FREE_PLAYS_PER_DAY }) : t('paywall.body')}</p>
        <button className="btn primary block" onClick={() => { setPremium(true); onClose(); }}>{t('paywall.cta')}</button>
        <button className="btn ghost" onClick={onClose}>{t('paywall.later')}</button>
      </div>
    </Modal>
  );
}

export function LessonDetail({ id }: { id: string }) {
  const t = useT();
  const s = useStore();
  const lesson = getLesson(id);
  const [paywall, setPaywall] = useState<null | 'lock' | 'limit'>(null);
  if (!lesson) return <div className="card">404</div>;
  const p = s.progress[id];
  const locked = !lesson.free && !s.premium;
  const meta = INSTRUMENT_META[lesson.instrument];
  const course = lesson.courseId ? getCourse(lesson.courseId) : null;
  const fav = s.favorites.includes(id);

  const go = (practice: boolean) => {
    if (locked) return setPaywall('lock');
    if (freePlaysLeft(s) <= 0) return setPaywall('limit');
    navigate({ name: 'play', id, practice });
  };

  return (
    <div className="fade-up col" style={{ gap: 16 }}>
      {paywall && <Paywall onClose={() => setPaywall(null)} limit={paywall === 'limit'} />}
      <div className="row between">
        <button className="btn ghost sm" style={{ marginLeft: -12 }} onClick={back}><Icon name="back" size={16} /> {t('nav.lessons')}</button>
        <button className="icon-circle" onClick={() => s.toggleFavorite(id)} aria-label="favorito" style={{ color: fav ? 'var(--red)' : 'var(--text-2)' }}><Icon name="heart" size={20} style={fav ? { fill: 'currentColor' } : undefined} /></button>
      </div>
      <div className="card elev" style={{ padding: 0, overflow: 'hidden', borderRadius: 'var(--radius-xl)' }}>
        <div className="lesson-art" style={{ height: 190 }}>
          <Art seed={lesson.id} color={lesson.art} accent={meta.accent} />
          {locked && <span className="lock"><Icon name="lock" size={12} /> {t('common.premium')}</span>}
        </div>
        <div style={{ padding: 22 }} className="col">
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="chip"><InstrumentIcon instrument={lesson.instrument} size={13} /> {meta.label}</span>
            <span className="chip">{t('common.grade', { n: lesson.grade })}</span>
            <span className="chip">{lesson.genre}</span>
            <span className="chip">{t(`kind.${lesson.kind}`)}</span>
            {lesson.free ? <span className="chip">{t('common.free')}</span> : <span className="chip gold">{t('common.premium')}</span>}
          </div>
          <h1>{lesson.title}</h1>
          <div className="muted">{lesson.artist}{course && <> · <a href={`#/courses/${course.id}`} style={{ color: 'var(--accent-2)' }}>{course.title}</a></>}</div>
          <p>{lesson.description}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            <div className="stat"><div className="v">{lesson.bpm}</div><div className="l">{t('detail.bpm')}</div></div>
            <div className="stat"><div className="v">{fmtDuration(lessonDurationSec(lesson))}</div><div className="l">{t('detail.duration')}</div></div>
            <div className="stat"><div className="v">{lesson.steps.length}</div><div className="l">{t('detail.steps')}</div></div>
            <div className="stat"><div className="v">{lessonNoteCount(lesson)}</div><div className="l">{t('detail.notes')}</div></div>
          </div>
          <div className="row between wrap card" style={{ background: 'var(--surface-2)', border: 0 }}>
            <div>
              <div className="tiny">{t('detail.best')}</div>
              <div className="row"><b style={{ fontSize: 22 }}>{p?.bestScore ?? '—'}</b><Stars n={p?.bestStars ?? 0} size={18} /></div>
            </div>
            <div className="tiny">{t('detail.attempts')}: {p?.attempts ?? 0}</div>
          </div>
          <div className="row wrap">
            <button className="btn primary lg" style={{ flex: 1 }} onClick={() => go(false)}><Icon name="play" size={16} /> {t('detail.playLesson')}</button>
            <button className="btn lg" style={{ flex: 1 }} onClick={() => go(true)}><Icon name="loop" size={16} /> {t('detail.practice')}</button>
          </div>
        </div>
      </div>
      <div className="card col">
        <h3>{t('detail.steps')}</h3>
        {lesson.steps.map((st, i) => (
          <div key={st.id} className="row between" style={{ padding: '8px 0', borderBottom: i < lesson.steps.length - 1 ? '1px solid var(--border)' : 0 }}>
            <div className="row">
              <span className="chip num" style={{ width: 30, padding: 0, justifyContent: 'center' }}>{i + 1}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{st.title}</div>
                {st.tip && <div className="tiny">{st.tip}</div>}
              </div>
            </div>
            <span className="tiny">{st.bars} {st.bars === 1 ? 'compás' : 'compases'} · {st.notes.length} ♪</span>
          </div>
        ))}
      </div>
      {p && p.history.length > 0 && (
        <div className="card col">
          <h3>{t('detail.history')}</h3>
          <div className="row" style={{ alignItems: 'flex-end', height: 80, gap: 4 }}>
            {p.history.map((h, i) => (
              <div key={i} title={`${h.score}% @ ${h.bpm} BPM`} style={{ flex: 1, height: `${h.score}%`, background: h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--gold)' : 'var(--red)', borderRadius: 4, minWidth: 6 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
