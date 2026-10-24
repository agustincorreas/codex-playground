import type { Pillars } from '../../engine/types';

const ITEMS: Array<{ key: keyof Omit<Pillars, 'score'>; letter: string; label: string }> = [
  { key: 'price', letter: '$', label: 'Precio en rango' },
  { key: 'change', letter: '%', label: 'Ya sube lo suficiente' },
  { key: 'rvol', letter: 'V', label: 'Volumen relativo alto' },
  { key: 'news', letter: 'N', label: 'Tiene noticia' },
  { key: 'float', letter: 'F', label: 'Float bajo' },
];

/** Los 5 pilares como cinco casilleros: lleno = cumple, vacío = no cumple, punteado = sin dato. */
export function PillarDots({ pillars }: { pillars: Pillars }) {
  const title = ITEMS.map((i) => {
    const v = pillars[i.key];
    return `${v === null ? '?' : v ? '✓' : '✗'} ${i.label}`;
  }).join('\n');
  return (
    <span className={`pillars score-${pillars.score}`} title={title} aria-label={`${pillars.score} de 5 pilares`}>
      {ITEMS.map((i) => {
        const v = pillars[i.key];
        return (
          <span key={i.key} className={`pillar ${v === null ? 'unknown' : v ? 'on' : 'off'}`}>
            {i.letter}
          </span>
        );
      })}
    </span>
  );
}

export function ScoreDots({ score }: { score: number }) {
  return (
    <span className={`score-dots score-${score}`} aria-label={`${score} de 5 pilares`} title={`${score} de 5 pilares`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < score ? 'on' : ''} />
      ))}
    </span>
  );
}
