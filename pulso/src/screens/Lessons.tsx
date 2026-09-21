import { useMemo, useState } from 'react';
import { LESSONS, GENRES } from '../content';
import { useStore } from '../store/useStore';
import { Empty, LessonCard } from '../components/ui';
import { useT } from '../i18n';
import { INSTRUMENT_META } from '../engine/instruments';
import type { Instrument } from '../engine/types';
import { Icon, INSTRUMENT_ICON } from '../components/Icon';

type Status = 'all' | 'new' | 'progress' | 'done' | 'fav';

export function Lessons({ kind }: { kind?: 'lesson' | 'song' | 'exercise' }) {
  const t = useT();
  const instrument = useStore((s) => s.instrument);
  const setInstrument = useStore((s) => s.setInstrument);
  const progress = useStore((s) => s.progress);
  const favorites = useStore((s) => s.favorites);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState<number | 0>(0);
  const [genre, setGenre] = useState<string>('');
  const [status, setStatus] = useState<Status>('all');

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return LESSONS.filter((l) => l.instrument === instrument)
      .filter((l) => (kind === 'exercise' ? l.kind === 'exercise' || l.kind === 'warmup' : kind ? l.kind === kind : true))
      .filter((l) => !grade || l.grade === grade)
      .filter((l) => !genre || l.genre === genre)
      .filter((l) => !qq || l.title.toLowerCase().includes(qq) || l.artist.toLowerCase().includes(qq) || l.tags.some((x) => x.includes(qq)))
      .filter((l) => {
        const p = progress[l.id];
        if (status === 'new') return !p;
        if (status === 'progress') return p && p.bestStars < 2;
        if (status === 'done') return p && p.bestStars >= 2;
        if (status === 'fav') return favorites.includes(l.id);
        return true;
      })
      .sort((a, b) => a.grade - b.grade || a.title.localeCompare(b.title));
  }, [instrument, kind, grade, genre, q, status, progress, favorites]);

  const grades = Array.from(new Set(LESSONS.filter((l) => l.instrument === instrument).map((l) => l.grade))).sort((a, b) => a - b);
  const title = kind === 'song' ? t('nav.songs') : kind === 'exercise' ? t('nav.exercises') : t('nav.lessons');

  return (
    <div className="fade-up col" style={{ gap: 14 }}>
      <div className="row between wrap">
        <h1>{title}</h1>
        <div className="segmented">
          {(Object.keys(INSTRUMENT_META) as Instrument[]).map((i) => (
            <button key={i} className={instrument === i ? 'active' : ''} onClick={() => setInstrument(i)} title={INSTRUMENT_META[i].label}><Icon name={INSTRUMENT_ICON[i]} size={16} /></button>
          ))}
        </div>
      </div>
      <input type="text" placeholder={t('lessons.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip ${grade === 0 ? 'active' : ''}`} onClick={() => setGrade(0)}>{t('lessons.grade')}: {t('lessons.all')}</button>
        {grades.map((g) => <button key={g} className={`chip ${grade === g ? 'active' : ''}`} onClick={() => setGrade(g)}>{g}</button>)}
      </div>
      <div className="chips">
        <button className={`chip ${!genre ? 'active' : ''}`} onClick={() => setGenre('')}>{t('lessons.genre')}: {t('lessons.all')}</button>
        {GENRES.map((g) => <button key={g} className={`chip ${genre === g ? 'active' : ''}`} onClick={() => setGenre(g)}>{g}</button>)}
      </div>
      <div className="chips">
        {([['all', t('lessons.all')], ['new', t('lessons.notStarted')], ['progress', t('lessons.inProgress')], ['done', t('lessons.completed')], ['fav', t('lessons.favorites')]] as [Status, string][]).map(([k, label]) => (
          <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{label}</button>
        ))}
      </div>
      <div className="tiny">{t('lessons.count', { n: list.length })}</div>
      {list.length === 0 ? <Empty>{t('lessons.none')}</Empty> : <div className="grid">{list.map((l) => <LessonCard key={l.id} lesson={l} />)}</div>}
    </div>
  );
}
