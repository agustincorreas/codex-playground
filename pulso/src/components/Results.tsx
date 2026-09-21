import type { Lesson, LessonResult, StepScore } from '../engine/types';
import { useT } from '../i18n';
import { Stars } from './ui';
import { JUDGEMENT_COLORS, STAR_THRESHOLDS } from '../engine/scoring';
import { TROPHY_DEFS } from '../store/useStore';
import type { HitResult } from '../engine/types';

interface Props {
  lesson: Lesson;
  result: LessonResult;
  perf: StepScore;
  hits: HitResult[];
  isNewBest: boolean;
  isRecord: boolean;
  newTrophies: string[];
  leveledUp: boolean;
  goalJustHit: boolean;
  next: Lesson | null;
  onRetry: () => void;
  onPractice: () => void;
  onNext: () => void;
  onHome: () => void;
}

export function Results(p: Props) {
  const t = useT();
  const { result, perf } = p;
  const tip = perf.miss > perf.total * 0.3 ? t('results.tip.miss') : perf.early > perf.late && perf.early > perf.total * 0.15 ? t('results.tip.early') : perf.late > perf.total * 0.15 ? t('results.tip.late') : t('results.tip.great');
  const passed = result.score >= STAR_THRESHOLDS[0];
  return (
    <div className="results">
      <div className="results-card fade-up">
        <div className="tiny" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>{t('results.title')} · {p.lesson.title}</div>
        <div className="stars-big">{[1, 2, 3].map((i) => <span key={i} className={i <= result.stars ? '' : 'off'}>⭐</span>)}</div>
        <div className="score-big">{result.score}</div>
        <div style={{ fontWeight: 800, fontSize: 18, color: passed ? 'var(--green)' : 'var(--orange)' }}>{passed ? t('results.pass') : t('results.fail')}</div>
        <div className="row wrap" style={{ justifyContent: 'center', gap: 6 }}>
          {p.isNewBest && <span className="chip gold">🏅 {t('results.newBest')}</span>}
          {p.isRecord && <span className="chip gold">💿 {t('results.record')}</span>}
          {p.leveledUp && <span className="chip active">⬆️ {t('results.levelUp')}</span>}
          {p.goalJustHit && <span className="chip active">🎯 {t('results.goalHit')}</span>}
          <span className="chip">+{result.xp} {t('results.xp')}</span>
          <span className="chip">{result.bpm} BPM</span>
        </div>
        {p.newTrophies.length > 0 && (
          <div className="card row wrap" style={{ justifyContent: 'center', width: '100%' }}>
            {p.newTrophies.map((id) => {
              const d = TROPHY_DEFS.find((x) => x.id === id)!;
              return <div key={id}><span style={{ fontSize: 28 }}>{d.emoji}</span> <b>{t('results.trophy')}: {d.title}</b></div>;
            })}
          </div>
        )}
        <div className="breakdown">
          <div><b style={{ color: JUDGEMENT_COLORS.perfect }}>{perf.perfect}</b><span>{t('results.perfect')}</span></div>
          <div><b style={{ color: JUDGEMENT_COLORS.early }}>{perf.early}</b><span>{t('results.early')}</span></div>
          <div><b style={{ color: JUDGEMENT_COLORS.late }}>{perf.late}</b><span>{t('results.late')}</span></div>
          <div><b style={{ color: JUDGEMENT_COLORS.miss }}>{perf.miss}</b><span>{t('results.miss')}</span></div>
          <div><b style={{ color: JUDGEMENT_COLORS.extra }}>{perf.extra}</b><span>{t('results.extra')}</span></div>
        </div>
        <div className="timeline" title="timing">
          {p.hits.filter((h) => h.noteIndex != null).map((h, i) => (
            <i key={i} style={{ background: JUDGEMENT_COLORS[h.judgement], height: h.judgement === 'miss' ? '100%' : `${Math.min(100, 30 + Math.abs(h.deltaMs) / 2)}%` }} />
          ))}
        </div>
        <div className="row between" style={{ width: '100%' }}>
          <span className="tiny">{t('results.bestStreak')}: <b>{perf.bestStreak}</b></span>
          <span className="tiny">{result.steps.length} {t('detail.steps').toLowerCase()}</span>
        </div>
        <p className="muted">{tip}</p>
        <div className="col" style={{ width: '100%' }}>
          {p.next && <button className="btn primary block" onClick={p.onNext}>{t('results.next')}: {p.next.title} →</button>}
          <div className="row">
            <button className="btn block" onClick={p.onRetry}>🔄 {t('results.retry')}</button>
            <button className="btn block" onClick={p.onPractice}>🔁 {t('results.practice')}</button>
          </div>
          <button className="btn ghost block" onClick={p.onHome}>{t('results.home')}</button>
        </div>
        <div className="tiny">
          <Stars n={1} /> {STAR_THRESHOLDS[0]} · <Stars n={2} /> {STAR_THRESHOLDS[1]} · <Stars n={3} /> {STAR_THRESHOLDS[2]}
        </div>
      </div>
    </div>
  );
}
