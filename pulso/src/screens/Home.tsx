import { useMemo } from 'react';
import { useStore, computeStreak, todayKey, freePlaysLeft } from '../store/useStore';
import { COURSES, getLesson, LESSONS } from '../content';
import { LessonCard, Ring } from '../components/ui';
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

  return (
    <div className="fade-up">
      <div className="row between wrap">
        <div>
          <h1>{t('home.greeting', { name: s.name })}</h1>
          <div className="row" style={{ marginTop: 6 }}>
            <div className="segmented">
              {(Object.keys(INSTRUMENT_META) as Instrument[]).map((i) => (
                <button key={i} className={s.instrument === i ? 'active' : ''} onClick={() => s.setInstrument(i)}>
                  {INSTRUMENT_META[i].emoji} {INSTRUMENT_META[i].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!s.premium ? (
          <span className="chip gold">{t('home.freeLeft', { n: free })}</span>
        ) : (
          <span className="chip gold">★ {t('home.premium')}</span>
        )}
      </div>

      <div className="section" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="card row" style={{ gap: 16 }}>
          <Ring value={doneSec / goalSec} size={84} color="var(--accent-2)">
            <b style={{ fontSize: 14 }}>{Math.floor(doneSec / 60)}</b>
            <div className="tiny">min</div>
          </Ring>
          <div>
            <div className="tiny" style={{ textTransform: 'uppercase', fontWeight: 700 }}>{t('home.dailyGoal')}</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{doneSec >= goalSec ? t('home.goalDone') : t('home.minutesOf', { done: Math.floor(doneSec / 60), goal: s.settings.dailyGoalMin })}</div>
          </div>
        </div>
        <div className="card row" style={{ gap: 16 }}>
          <div style={{ fontSize: 44 }}>{streak > 0 ? '🔥' : '🧊'}</div>
          <div>
            <div className="tiny" style={{ textTransform: 'uppercase', fontWeight: 700 }}>{t('home.streak')}</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{streak} {t('home.days')}</div>
          </div>
        </div>
        <div className="card">
          <div className="row between">
            <div className="tiny" style={{ textTransform: 'uppercase', fontWeight: 700 }}>{t('home.level')} {lvl.level}</div>
            <div className="tiny">{lvl.into}/{lvl.needed} XP</div>
          </div>
          <div className="progress-bar" style={{ marginTop: 10 }}><i style={{ width: `${(lvl.into / lvl.needed) * 100}%` }} /></div>
          <div className="tiny" style={{ marginTop: 8 }}>{Object.values(s.progress).reduce((a, p) => a + p.bestStars, 0)} ★ · {Object.values(s.progress).filter((p) => p.bestStars >= 2).length} 💿</div>
        </div>
      </div>

      {continueLesson && (
        <div className="section">
          <div className="section-head"><h2>{t('home.continue')}</h2></div>
          <div className="card row between wrap" style={{ background: `linear-gradient(120deg, ${continueLesson.art}33, var(--card))` }}>
            <div>
              <div className="tiny">{INSTRUMENT_META[continueLesson.instrument].emoji} {t('common.grade', { n: continueLesson.grade })} · {continueLesson.genre}</div>
              <h3 style={{ fontSize: 20 }}>{continueLesson.title}</h3>
              <div className="muted">{continueLesson.artist}</div>
            </div>
            <button className="btn primary" onClick={() => navigate({ name: 'play', id: continueLesson.id })}>▶ {t('home.play')}</button>
          </div>
        </div>
      )}

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
