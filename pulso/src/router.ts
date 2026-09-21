import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'lessons'; kind?: 'lesson' | 'song' | 'exercise' }
  | { name: 'courses' }
  | { name: 'course'; id: string }
  | { name: 'lesson'; id: string }
  | { name: 'play'; id: string; practice?: boolean }
  | { name: 'progress' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query ?? '');
  switch (parts[0]) {
    case 'lessons':
      return { name: 'lessons', kind: (q.get('kind') as 'lesson' | 'song' | 'exercise' | null) ?? undefined };
    case 'songs':
      return { name: 'lessons', kind: 'song' };
    case 'exercises':
      return { name: 'lessons', kind: 'exercise' };
    case 'courses':
      return parts[1] ? { name: 'course', id: parts[1] } : { name: 'courses' };
    case 'lesson':
      return { name: 'lesson', id: parts[1] ?? '' };
    case 'play':
      return { name: 'play', id: parts[1] ?? '', practice: q.get('practice') === '1' };
    case 'progress':
      return { name: 'progress' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function toHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'lessons': return r.kind ? `#/lessons?kind=${r.kind}` : '#/lessons';
    case 'courses': return '#/courses';
    case 'course': return `#/courses/${r.id}`;
    case 'lesson': return `#/lesson/${r.id}`;
    case 'play': return `#/play/${r.id}${r.practice ? '?practice=1' : ''}`;
    case 'progress': return '#/progress';
    case 'settings': return '#/settings';
  }
}

export function navigate(r: Route, replace = false) {
  const h = toHash(r);
  if (replace) window.history.replaceState(null, '', h);
  else window.location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function back() {
  if (window.history.length > 1) window.history.back();
  else navigate({ name: 'home' });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
