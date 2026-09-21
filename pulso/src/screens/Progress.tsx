import { useStore, computeStreak, bestStreak, TROPHY_DEFS, todayKey, dayOffset } from '../store/useStore';
import { levelFromXp } from '../engine/scoring';
import { useT } from '../i18n';
import { Ring } from '../components/ui';
import { getLesson } from '../content';
import { INSTRUMENT_META } from '../engine/instruments';
import type { Instrument } from '../engine/types';
import { Icon, INSTRUMENT_ICON } from '../components/Icon';

function fmtTotal(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function Progress() {
  const t = useT();
  const s = useStore();
  const lvl = levelFromXp(s.xp);
  const stars = Object.values(s.progress).reduce((a, p) => a + p.bestStars, 0);
  const records = Object.values(s.progress).filter((p) => p.bestStars >= 2).length;
  const total = Object.values(s.practice).reduce((a, b) => a + b, 0);
  const today = todayKey();
  const weekDays = Array.from({ length: 7 }, (_, i) => dayOffset(today, i - 6));
  const weekSec = weekDays.reduce((a, d) => a + (s.practice[d] ?? 0), 0);
  const heatDays = Array.from({ length: 12 * 7 }, (_, i) => dayOffset(today, i - (12 * 7 - 1)));
  const goalSec = s.settings.dailyGoalMin * 60;
  const byInstrument = (Object.keys(INSTRUMENT_META) as Instrument[]).map((i) => {
    const ids = Object.keys(s.progress).filter((id) => getLesson(id)?.instrument === i);
    return { i, lessons: ids.length, stars: ids.reduce((a, id) => a + s.progress[id].bestStars, 0) };
  });

  return (
    <div className="fade-up col" style={{ gap: 16 }}>
      <h1>{t('progress.title')}</h1>
      <div className="card row" style={{ gap: 20 }}>
        <Ring value={lvl.into / lvl.needed} size={110} stroke={10}>
          <div className="tiny">{t('progress.level')}</div>
          <b style={{ fontSize: 30 }}>{lvl.level}</b>
        </Ring>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{s.xp} XP</div>
          <div className="muted">{t('progress.toNext', { n: lvl.needed - lvl.into, l: lvl.level + 1 })}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div className="stat"><div className="v"><Icon name="star" size={20} style={{ color: 'var(--gold)' }} /> {stars}</div><div className="l">{t('progress.stars')}</div></div>
        <div className="stat"><div className="v"><Icon name="disc" size={20} style={{ color: 'var(--teal)' }} /> {records}</div><div className="l">{t('progress.records')}</div></div>
        <div className="stat"><div className="v">{Object.keys(s.progress).length}</div><div className="l">{t('progress.lessons')}</div></div>
        <div className="stat"><div className="v"><Icon name="flame" size={20} style={{ color: 'var(--orange)' }} /> {computeStreak(s.practice)}</div><div className="l">{t('progress.streak')}</div></div>
        <div className="stat"><div className="v">{bestStreak(s.practice)}</div><div className="l">{t('progress.bestStreak')}</div></div>
        <div className="stat"><div className="v"><Icon name="target" size={20} style={{ color: 'var(--green)' }} /> {s.goalsHit.length}</div><div className="l">{t('progress.goals')}</div></div>
        <div className="stat"><div className="v">{fmtTotal(total)}</div><div className="l">{t('progress.time')}</div></div>
        <div className="stat"><div className="v">{fmtTotal(weekSec)}</div><div className="l">{t('progress.week')}</div></div>
      </div>

      <div className="card col">
        <h3>{t('progress.week')}</h3>
        <div className="row" style={{ alignItems: 'flex-end', height: 110, gap: 8 }}>
          {weekDays.map((d) => {
            const v = s.practice[d] ?? 0;
            const pct = Math.min(100, (v / goalSec) * 100);
            const [, , dd] = d.split('-');
            return (
              <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <div className="tiny">{Math.round(v / 60)}m</div>
                <div style={{ width: '100%', maxWidth: 28, height: `${Math.max(4, pct * 0.7)}%`, background: v >= goalSec ? 'var(--green)' : 'var(--accent)', borderRadius: 6, opacity: v ? 1 : 0.25 }} />
                <div className="tiny">{Number(dd)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card col">
        <h3>{t('progress.activity')}</h3>
        <div className="heat">
          {heatDays.map((d) => {
            const v = s.practice[d] ?? 0;
            const a = v === 0 ? 0 : Math.min(1, 0.3 + v / goalSec);
            return <i key={d} title={`${d}: ${Math.round(v / 60)} min`} style={{ background: v ? `rgba(124,92,255,${a})` : undefined }} />;
          })}
        </div>
      </div>

      <div className="card col">
        <h3>{t('progress.byInstrument')}</h3>
        {byInstrument.map((b) => (
          <div key={b.i} className="row between" style={{ padding: '6px 0' }}>
            <span className="row" style={{ gap: 8 }}><Icon name={INSTRUMENT_ICON[b.i]} size={16} style={{ color: 'var(--text-2)' }} /> {INSTRUMENT_META[b.i].label}</span>
            <span className="tiny">{b.lessons} {t('progress.lessons').toLowerCase()} · ★ {b.stars}</span>
          </div>
        ))}
      </div>

      <div className="card col">
        <h3>{t('progress.trophies')} ({s.trophies.length}/{TROPHY_DEFS.length})</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {TROPHY_DEFS.map((td) => {
            const u = s.trophies.find((x) => x.id === td.id);
            return (
              <div key={td.id} className="stat" style={{ opacity: u ? 1 : 0.4, textAlign: 'center', alignItems: 'center' }}>
                <div className="icon-circle" style={{ width: 52, height: 52, borderRadius: 16, fontSize: 24, filter: u ? 'none' : 'grayscale(1)' }}>{td.emoji}</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{td.title}</div>
                <div className="tiny">{u ? td.description : t('progress.locked')}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
