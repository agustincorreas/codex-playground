import { useEffect } from 'react';
import { useRoute, navigate, type Route } from './router';
import { useStore } from './store/useStore';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Lessons } from './screens/Lessons';
import { Courses, CourseDetail } from './screens/Courses';
import { LessonDetail } from './screens/LessonDetail';
import { Progress } from './screens/Progress';
import { Settings } from './screens/Settings';
import { Player } from './screens/Player';
import { useT } from './i18n';
import { inputManager } from './input/inputManager';
import { setBackingVolume, setMasterVolume } from './audio/engine';

const NAV: { route: Route; key: 'nav.home' | 'nav.lessons' | 'nav.courses' | 'nav.songs' | 'nav.exercises' | 'nav.progress' | 'nav.settings'; ico: string; match: (r: Route) => boolean }[] = [
  { route: { name: 'home' }, key: 'nav.home', ico: '🏠', match: (r) => r.name === 'home' },
  { route: { name: 'lessons' }, key: 'nav.lessons', ico: '🎵', match: (r) => (r.name === 'lessons' && !r.kind) || r.name === 'lesson' },
  { route: { name: 'courses' }, key: 'nav.courses', ico: '📚', match: (r) => r.name === 'courses' || r.name === 'course' },
  { route: { name: 'lessons', kind: 'song' }, key: 'nav.songs', ico: '🎤', match: (r) => r.name === 'lessons' && r.kind === 'song' },
  { route: { name: 'lessons', kind: 'exercise' }, key: 'nav.exercises', ico: '🏋️', match: (r) => r.name === 'lessons' && r.kind === 'exercise' },
  { route: { name: 'progress' }, key: 'nav.progress', ico: '📈', match: (r) => r.name === 'progress' },
  { route: { name: 'settings' }, key: 'nav.settings', ico: '⚙️', match: (r) => r.name === 'settings' },
];
const MOBILE_NAV = NAV.filter((n) => n.key !== 'nav.songs' && n.key !== 'nav.exercises');

export default function App() {
  const route = useRoute();
  const onboarded = useStore((s) => s.onboarded);
  const theme = useStore((s) => s.settings.theme);
  const settings = useStore((s) => s.settings);
  const t = useT();

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1020' : '#f3f4fb');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    inputManager.setDevice(settings.midiDevice);
    setMasterVolume(settings.volume);
    setBackingVolume(settings.backingVolume);
  }, [settings.midiDevice, settings.volume, settings.backingVolume]);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  if (!onboarded) return <Onboarding />;
  if (route.name === 'play') return <Player key={route.id + String(route.practice)} id={route.id} practice={route.practice} />;

  let screen: React.ReactNode;
  switch (route.name) {
    case 'lessons': screen = <Lessons key={route.kind ?? 'all'} kind={route.kind} />; break;
    case 'courses': screen = <Courses />; break;
    case 'course': screen = <CourseDetail id={route.id} />; break;
    case 'lesson': screen = <LessonDetail id={route.id} />; break;
    case 'progress': screen = <Progress />; break;
    case 'settings': screen = <Settings />; break;
    default: screen = <Home />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-logo">〰️</div>Pulso</div>
        {NAV.map((n) => (
          <button key={n.key} className={`nav-item ${n.match(route) ? 'active' : ''}`} onClick={() => navigate(n.route)}>
            <span className="ico">{n.ico}</span>{t(n.key)}
          </button>
        ))}
        <div className="sidebar-foot">Pulso · v1.0</div>
      </aside>
      <main className="main">{screen}</main>
      <nav className="tabbar">
        {MOBILE_NAV.map((n) => (
          <button key={n.key} className={n.match(route) ? 'active' : ''} onClick={() => navigate(n.route)}>
            <span className="ico">{n.ico}</span>{t(n.key)}
          </button>
        ))}
      </nav>
    </div>
  );
}
