import { useMemo } from 'react';
import { useStore, computeStreak, todayKey, freePlaysLeft } from '../store/useStore';
import { COURSES, getLesson, LESSONS } from '../content';
import { LessonCard, Ring, Art } from '../components/ui';
import { Icon, INSTRUMENT_ICON } from '../components/Icon';
import { navigate } from '../router';
import { useT } from '../i18n';
import { levelFromXp } from '../engine/scoring';
import { INSTRUMENT_META } from '../engine/instruments';
import type { Instrument } from '../engine/types';
import { CourseCard } from './Courses';

export function Home() {
  const t = useT();
  const s = useStore();
  const streak = computeStreak(s.practice);
  const doneSec = s.practice[todayKey()] ?? 0;
  const goalSec = s.settings.dailyGoalMin * 60;
  const lvl = levelFromXp(s.xp);
  const free = freePlaysLeft(s);

  const continueLesson = s.lastLessonId ? getLesson(s.lastLessonId) : null;
  const recommended = useMemo(() => {
    const mine = LESSONS.filter((l) => l.instrument === s.instrument && l.kind === 'lesson');
    const done = new Set(Object.keys(s.progress).filter((id) => (s.progress[id]?.bestStars ?? 0) >= 2));
    const targetGrade = s.experience === 'pro' ? 6 : s.experience === 'some' ? 3 : 1;
    const maxDone = Math.max(targetGrade, ...mine.filter((l) => done.has(l.id)).map((l) => l.grade));
    return mine.filter((l) => !done.has(l.id)).sort((a, b) => Math.abs(a.grade - maxDone) - Math.abs(b.grade - maxDone) || a.grade - b.grade).slice(0, 8);
  }, [s.instrument, s.progress, s.experience]);
  const courses = COURSES.filter((c) => c.instrument === s.instrument);
  const songs = LESSONS.filter((l) => l.instrument === s.instrument && l.kind === 'song').slice(0, 6);
  const warmups = LESSONS.filter((l) => l.instrument === s.instrument && (l.kind === 'warmup' || l.kind === 'exercise')).slice(0, 6);
  const recent = s.recentLessonIds.map(getLesson).filter(Boolean).slice(0, 6);
  const hero = continueLesson ?? recommended[0];
  const stars = Object.values(s.progress).reduce((a, p) => a + p.bestStars, 0);
  const records = Object.values(s.progress).filter((p) => p.bestStars >= 2).length;

  return (
    <div className="fade-up">
      <div className="row between wrap" style={{ gap: 16 }}>
        <div className="col" style={{ gap: 10 }}>
          <div className="eyebrow">{new Date().toLocaleDateString(s.settings.lang === 'es' ? 'es-AR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{t('home.greeting', { name: s.name })}</h1>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="segmented">
            {(Object.keys(INSTRUMENT_META) as Instrument[]).map((i) => (
              <button key={i} className={s.instrument === i ? 'active' : ''} onClick={() => s.setInstrument(i)}>
                <Icon name={INSTRUMENT_ICON[i]} size={16} /> {INSTRUMENT_META[i].label}
              </button>
            ))}
          </div>
          {!s.premium ? <span className="chip gold"><Icon name="sparkle" size={13} /> {t('home.freeLeft', { n: free })}</span> : <span className="chip gold"><Icon name="sparkle" size={13} /> {t('home.premium')}</span>}
        </div>
      </div>

      {hero && (
        <div className="section" style={{ marginTop: 28 }}>
          <button className="card elev" style={{ width: '100%', textAlign: 'left', padding: 0, overflow: 'hidden', borderRadius: 'var(--radius-xl)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', position: 'relative' }} onClick={() => navigate({ name: 'play', id: hero.id })}>
            <div style={{ position: 'absolute', inset: 0, opacity: 0.9 }}><Art seed={hero.id} color={hero.art} accent={INSTRUMENT_META[hero.instrument].accent} /></div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(8,8,11,.92) 0%, rgba(8,8,11,.75) 55%, rgba(8,8,11,.3) 100%)' }} />
            <div style={{ position: 'relative', padding: '30px 28px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 210, justifyContent: 'flex-end', color: '#f5f5f7' }}>
              <div className="eyebrow" style={{ color: 'rgba(245,245,247,.6)' }}>{continueLesson ? t('home.continue') : t('home.recommended')}</div>
              <div>
                <h2 style={{ fontSize: 30, letterSpacing: '-0.03em' }}>{hero.title}</h2>
                <div style={{ color: 'rgba(245,245,247,.65)', marginTop: 4 }}>{hero.artist} · {t('common.grade', { n: hero.grade })} · {hero.bpm} BPM</div>
              </div>
              <div className="row">
                <span className="btn primary"><Icon name="play" size={16} /> {t('home.play')}</span>
                <span className="tiny" style={{ color: 'rgba(245,245,247,.55)' }}>{hero.steps.length} {t('detail.steps').toLowerCase()}</span>
              </div>
            </div>
          </button>
        </div>
      )}

      <div className="section" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 16 }}>
        <div className="card row" style={{ gap: 18 }}>
          <Ring value={doneSec / goalSec} size={72} stroke={7} color="var(--teal)">
            <b className="num" style={{ fontSize: 15 }}>{Math.floor(doneSec / 60)}</b>
          </Ring>
          <div>
            <div className="eyebrow">{t('home.dailyGoal')}</div>
            <div style={{ fontWeight: 600, fontSize: 17, marginTop: 4, letterSpacing: '-0.01em' }}>{doneSec >= goalSec ? t('home.goalDone') : t('home.minutesOf', { done: Math.floor(doneSec / 60), goal: s.settings.dailyGoalMin })}</div>
          </div>
        </div>
        <div className="card row" style={{ gap: 18 }}>
          <div className="icon-circle" style={{ width: 72, height: 72, borderRadius: 22, color: streak > 0 ? 'var(--orange)' : 'var(--text-3)' }}><Icon name="flame" size={30} /></div>
          <div>
            <div className="eyebrow">{t('home.streak')}</div>
            <div style={{ fontWeight: 600, fontSize: 17, marginTop: 4 }}><span className="num">{streak}</span> {t('home.days')}</div>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
          <div className="row between">
            <div className="eyebrow">{t('home.level')} {lvl.level}</div>
            <div className="tiny num">{lvl.into}/{lvl.needed} XP</div>
          </div>
          <div className="progress-bar"><i style={{ width: `${(lvl.into / lvl.needed) * 100}%` }} /></div>
          <div className="row" style={{ gap: 14 }}>
            <span className="tiny row" style={{ gap: 4 }}><Icon name="star" size={12} style={{ color: 'var(--gold)' }} /> {stars}</span>
            <span className="tiny row" style={{ gap: 4 }}><Icon name="disc" size={12} /> {records}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h2>{t('home.recommended')}</h2><a href="#/lessons">{t('home.seeAll')}</a></div>
        <div className="hscroll">{recommended.map((l) => <LessonCard key={l.id} lesson={l} />)}</div>
      </div>

      <div className="section">
        <div className="section-head"><h2>{t('home.courses')}</h2><a href="#/courses">{t('home.seeAll')}</a></div>
        <div className="hscroll">{courses.map((c) => <CourseCard key={c.id} course={c} />)}</div>
      </div>

      {songs.length > 0 && (
        <div className="section">
          <div className="section-head"><h2>{t('home.songs')}</h2><a href="#/songs">{t('home.seeAll')}</a></div>
          <div className="hscroll">{songs.map((l) => <LessonCard key={l.id} lesson={l} />)}</div>
        </div>
      )}
      {warmups.length > 0 && (
        <div className="section">
          <div className="section-head"><h2>{t('home.warmups')}</h2><a href="#/exercises">{t('home.seeAll')}</a></div>
          <div className="hscroll">{warmups.map((l) => <LessonCard key={l.id} lesson={l} compact />)}</div>
        </div>
      )}
      {recent.length > 0 && (
        <div className="section">
          <div className="section-head"><h2>{t('home.recent')}</h2></div>
          <div className="hscroll">{recent.map((l) => <LessonCard key={l!.id} lesson={l!} compact />)}</div>
        </div>
      )}
    </div>
  );
}
