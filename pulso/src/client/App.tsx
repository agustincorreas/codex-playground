import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatCountdown } from '../engine/time';
import type { Alert, AlertType, NewsItem, ProviderStatus, ScannerId, Settings, SymbolDetail, ViewModel } from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';
import { createTrainingStore, LocalTrainingStore, ServerTrainingStore, type TrainingStore } from '../trading/store';
import type { Hotkey } from '../trading/types';
import { AccountValue, PositionsWindow, TodayTrades, TradeActivity } from './components/Account';
import { Chart, type ChartFill, type ChartOrder, type ChartPosition } from './components/Chart';
import { Header, MobileTabs, SettingsModal, type MobileTab, type Prefs } from './components/Chrome';
import { Detail } from './components/Detail';
import { AlertFeed, HaltsPanel, HodBoard, MomentumFeed, NewsPanel, WatchlistPanel } from './components/Feeds';
import { Journal } from './components/Journal';
import { NewDayDialog } from './components/NewDayDialog';
import { Level2, num, type TicketForm } from './components/Level2';
import { IconVoice } from './components/Icons';
import { MobileTradeBar } from './components/MobileTradeBar';
import { DayResult, MyTrades } from './components/MyTrades';
import { Empty, Panel } from './components/Panel';
import { PracticeSettings } from './components/PracticeSettings';
import { SCANNER_COLUMNS, ScannerTable } from './components/ScannerTable';
import { WindowGrid, type PanelId } from './components/WindowGrid';
import { DEFAULT_SOUND_TYPES } from './lib/alertMeta';
import { beep, playOrder, speak, unlockAudio } from './lib/audio';
import { matches, typing } from './lib/hotkeys';
import { fmtVolume } from './lib/format';
import { readNow, setClock } from './lib/now';
import { useStable } from './lib/stable';
import { fmtDay, HEAT_HINT, HEAT_LABEL } from './lib/days';
import { crossAlerts, subscribeDrawings, symbolsWithAlerts } from './lib/drawings';
import { load, save } from './lib/storage';
import { LocalSource, type SimConfig } from './source/local';
import { detectServer, RemoteSource } from './source/remote';
import type { HistoryTf } from '../engine/history';
import type { DataSource } from './source/types';
import { AiTrader } from './aitrader';
import { AiTraderPanel } from './components/AiTrader';
import { nyMarket, TrainingController, useTrainingVersion } from './training';

const DEFAULT_PREFS: Prefs = {
  sound: true,
  voice: true,
  voiceLang: 'es',
  soundMinScore: 3,
  soundTypes: DEFAULT_SOUND_TYPES,
  momentumMinScore: 3,
  theme: 'system',
  audioV: 2,
};

/** Señales que se leen en voz alta: las de momentum (algo que se está moviendo ahora) y los halts. */
const VOICE_TYPES = new Set<AlertType>(['hod', 'squeeze', 'running', 'bullFlag', 'pmhBreak', 'volume', 'halt', 'resume', 'priceLine']);
/** Si llegan varias juntas, suena la más importante. */
const ALERT_PRIORITY: Partial<Record<AlertType, number>> = { halt: 9, priceLine: 9, resume: 8, squeeze: 7, bullFlag: 6, running: 5, pmhBreak: 4, hod: 3, volume: 2 };
/** La misma acción no se vuelve a leer en voz alta antes de este tiempo (salvo halts). */
const VOICE_COOLDOWN_MS = 45_000;

const SCANNER_LABEL: Record<ScannerId, string> = {
  gappers: 'Top gappers',
  pillars: '5 pilares',
  running: 'Subiendo ahora',
  lowFloat: 'Low float',
  rvol: 'Volumen relativo',
  fades: 'Se desinflan',
};

/** Pestaña del celular en la que vive cada ventana: ahí solo se monta lo que se ve. */
const PANEL_TAB: Record<PanelId, MobileTab> = { trades: 'chart', momo: 'momo', scan: 'scan', l2: 'chart', quote: 'news', chart1: 'chart', chart5: 'news', pos: 'chart', orders: 'chart' };

function scannerHelp(id: ScannerId, s: Settings): string {
  const range = `$${s.priceMin}–$${s.priceMax}`;
  switch (id) {
    case 'gappers':
      return `Suben ${s.gapperMinPct}% o más contra el cierre anterior, precio ${range}, volumen desde ${fmtVolume(s.minVolume)}. Ordenadas por % de suba.`;
    case 'pillars':
      return `Cumplen al menos ${s.pillarsMinScore} de los 5 pilares: precio ${range}, suba ≥ ${s.minChangePct}%, volumen relativo ≥ ${s.minRvol}x, noticia en las últimas ${s.newsWindowHours} h y float < ${s.maxFloat / 1e6}M.`;
    case 'running':
      return `Suben ${s.runMinPct5m}% o más en los últimos 5 minutos. Ordenadas por la suba de 5 minutos.`;
    case 'lowFloat':
      return `Float de hasta ${s.maxFloatSoft / 1e6}M acciones que suben ${s.gapperMinPct}% o más. La rotación es volumen del día / float.`;
    case 'rvol':
      return 'Volumen relativo de 2x o más, ajustado por horario (lo operado hoy contra lo normal a esta hora).';
    case 'fades':
      return 'Llegaron a subir 20% o más y ahora están 15% o más debajo del máximo del día: señal de debilidad.';
  }
}

function effectiveThemeNow(): 'dark' | 'light' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function BootScreen({ message }: { message: string }) {
  return (
    <div className="boot">
      <div className="boot-card">
        <span className="brand-name">Pulso</span>
        <p>{message}</p>
        <span className="boot-bar" />
      </div>
    </div>
  );
}

/** "Mercado ahora" con Nueva York cerrado: cuándo abre y la opción de practicar otro día. */
function MarketClosed({ until, onPractice, onJournal, onNewDay }: { until: number; onPractice: () => void; onJournal: () => void; onNewDay: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const day = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/New_York' }).format(until);
  return (
    <div className="closed-card" role="status">
      <h2>Nueva York está cerrado</h2>
      <p>
        "Mercado ahora" sigue la hora real de Nueva York. El pre-market abre el <b>{day} a las 4:00 ET</b>, en <span className="mono">{formatCountdown(until - now)}</span>, y el día arranca solo.
      </p>
      <p className="t-muted">Mientras tanto podés practicar con un día simulado, a la hora que quieras.</p>
      <div className="closed-actions">
        <button className="btn primary" onClick={onPractice}>
          Practicar con un día simulado
        </button>
        <button className="btn" onClick={onJournal}>
          Ver mi cuenta y el diario
        </button>
        <button className="btn ghost" onClick={onNewDay}>
          Elegir otro día…
        </button>
      </div>
    </div>
  );
}

/** Arranque: ¿hay servidor de Pulso? ¿dónde se guarda la cuenta de práctica? */
export function App() {
  const [boot, setBoot] = useState<{ server: boolean; hasServer: boolean; c: TrainingController } | null>(null);
  const [msg, setMsg] = useState('Buscando el servidor de datos…');
  useEffect(() => {
    let alive = true;
    void (async () => {
      // El simulador se elige con `?demo` en la URL o con el botón del encabezado (queda recordado).
      const params = new URLSearchParams(location.search);
      const wantSim = params.has('demo') || (!params.has('real') && load<string>('source', 'real') === 'sim');
      const health = await detectServer(true);
      const server = wantSim ? null : health;
      if (!alive) return;
      setMsg('Cargando tu cuenta de práctica…');
      // Con servidor, la cuenta vive ahí (una sola para todos los dispositivos, también en el simulador); si no, en Claude o acá.
      let store: TrainingStore = health ? new ServerTrainingStore() : await createTrainingStore();
      let loaded;
      let failed = false;
      let moved = false;
      try {
        loaded = await store.load();
      } catch {
        // Un error momentáneo de la base o del servidor: se reintenta una vez.
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
        try {
          loaded = await store.load();
        } catch {
          // Sin la base, se practica en este navegador (con claves propias: no reemplaza la cuenta de Claude).
          failed = store.kind !== 'navegador';
          store = new LocalTrainingStore(store.kind === 'cuenta' ? 'pulso:training-sin-cuenta' : 'pulso:training');
          loaded = await store.load();
        }
      }
      // Primera vez con el servidor: la cuenta que este navegador ya tenía pasa al servidor.
      if (store.kind === 'servidor' && !loaded.state && !loaded.sessions.length) {
        const old = await new LocalTrainingStore().load();
        if (old.state) {
          await store.saveState(old.state);
          for (const rec of old.sessions) await store.saveSession(rec);
          loaded = old;
          moved = true;
        }
      }
      if (!alive) return;
      const c = new TrainingController(store, loaded, server ? 'remote' : 'local');
      if (failed) c.notify(`No se pudo leer tu cuenta ${store.kind === 'cuenta' ? 'de Claude' : 'del servidor'}: esta sesión se guarda solo en este navegador.`, 'error');
      if (moved) c.notify('Tu cuenta de práctica pasó al servidor de Pulso: ahora es la misma desde cualquier dispositivo.', 'ok');
      setBoot({ server: !!server, hasServer: !!health, c });
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!boot) return <BootScreen message={msg} />;
  return <Workspace server={boot.server} hasServer={boot.hasServer} c={boot.c} />;
}

function Workspace({ server, hasServer, c }: { server: boolean; hasServer: boolean; c: TrainingController }) {
  useTrainingVersion(c);
  const [source, setSource] = useState<DataSource | null>(null);
  // Historia para los gráficos (días anteriores y temporalidades largas): la da la fuente de datos.
  const loadHistory = useMemo(() => (source?.history ? (sym: string, tf: HistoryTf) => source.history!(sym, tf) : undefined), [source]);
  const [view, setView] = useState<ViewModel | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [detail, setDetail] = useState<SymbolDetail | null>(null);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => load('settings', DEFAULT_SETTINGS));
  const [watch, setWatch] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = load('prefs', DEFAULT_PREFS);
    // Las alertas con sonido y voz pasaron a venir prendidas: se activan una vez para quien las tenía apagadas.
    return (p.audioV ?? 1) < 2 ? { ...p, sound: true, voice: true, audioV: 2 } : p;
  });
  const [audioLocked, setAudioLocked] = useState(true);
  /** Modo "reacomodar ventanas" (escritorio) y contador para volver a la disposición original. */
  const [layoutEdit, setLayoutEdit] = useState(false);
  const [layoutReset, setLayoutReset] = useState(0);
  const spokenAt = useRef(new Map<string, number>());
  // Alto de lo fijo de abajo en el celular (barra de operación + pestañas): la página deja ese espacio.
  const dockObs = useRef<ResizeObserver | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    dockObs.current?.disconnect();
    dockObs.current = null;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--dock-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    dockObs.current = new ResizeObserver(set);
    dockObs.current.observe(el);
  }, []);
  const lastVoice = useRef(0);
  const [tabs, setTabs] = useState<Record<string, string>>(() => load('tabs', { scan: 'gappers', momo: 'momentum', quote: 'quote', acct: 'pos' }));
  const [speed, setSpeed] = useState(1);
  const [mobileTab, setMobileTab] = useState<MobileTab>('scan');
  const [showSettings, setShowSettings] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [practiceSettings, setPracticeSettings] = useState(false);
  const [ticket, setTicketState] = useState<TicketForm>(() => ({
    sym: null,
    type: 'limit',
    price: '',
    shares: String(c.defaultShares()),
    route: 'SMRT',
    tif: c.state.settings.defaultTif,
    stop: '',
    target: '',
    setup: load('ticket-setup', 'Bull flag'),
    edited: false,
  }));
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const setTicket = useCallback((patch: Partial<TicketForm>) => {
    setTicketState((t) => {
      const next = { ...t, ...patch };
      if (patch.setup !== undefined) save('ticket-setup', next.setup);
      return next;
    });
  }, []);
  const [isMobile, setIsMobile] = useState(() => !!window.matchMedia?.('(max-width: 899px)').matches);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => effectiveThemeNow());
  // La fuente del simulador se recrea solo cuando empieza otro día (o se importa otra cuenta).
  const [sim, setSim] = useState<{ key: string; cfg: SimConfig } | null>(() => (c.simKey && c.simConfig ? { key: c.simKey, cfg: c.simConfig } : null));
  const [newDay, setNewDay] = useState<'ny' | 'practice' | 'any' | null>(null);

  const keySuffix = server ? '' : '-demo';
  // El IA Trader vive mientras dura la página; elige la acción a mostrar a través de `select`.
  const selectRef = useRef<(sym: string) => void>(() => undefined);
  const [trader] = useState(() => new AiTrader(c, (sym) => selectRef.current(sym)));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const prefsRef = useRef(prefs);
  const watchRef = useRef(watch);
  const selectedRef = useRef(selected);
  const lastSeedRef = useRef<number | undefined>(undefined);
  prefsRef.current = prefs;
  watchRef.current = watch;
  selectedRef.current = selected;

  useEffect(
    () =>
      c.subscribe(() => {
        const key = c.simKey;
        const cfg = c.simConfig;
        if (key && cfg && key !== sim?.key) setSim({ key, cfg });
        // "Mercado ahora" con Nueva York cerrado: el mercado de antes se detiene (queda la última vista).
        else if (!key && sim && c.nyClosedUntil !== null) setSim(null);
      }),
    [c, sim?.key],
  );

  // "Mercado ahora" con Nueva York cerrado: el día arranca solo cuando abre el pre-market.
  const closedUntil = c.nyClosedUntil;
  useEffect(() => {
    if (closedUntil === null) return;
    const id = setInterval(() => c.ensureSession(), 15_000);
    return () => clearInterval(id);
  }, [c, closedUntil]);

  // Fuente de datos: servidor de Pulso (en vivo) o simulador local con la semilla del día de práctica.
  useEffect(() => {
    if (!server && !sim) return;
    // Un día simulado nuevo trae otras acciones: la watchlist y la selección del día anterior no sirven.
    if (!server && lastSeedRef.current !== undefined && lastSeedRef.current !== sim?.cfg.seed) {
      save('watch-demo', []);
      save('selected-demo', null);
    }
    lastSeedRef.current = sim?.cfg.seed;
    const savedWatch = load<string[]>(`watch${keySuffix}`, []);
    const savedSel = load<string | null>(`selected${keySuffix}`, null);
    watchRef.current = savedWatch;
    selectedRef.current = savedSel;
    setWatch(savedWatch);
    setSelected(savedSel);
    setView(null);
    setDetail(null);
    setAlerts([]);
    setNews([]);
    let firstViewSeen = false;
    const src: DataSource = server ? new RemoteSource(settings, savedWatch, c.storeClientId) : new LocalSource(settings, savedWatch, sim!.cfg);
    src.start({
      onView: (v) => {
        setView(v);
        checkLineAlerts(src);
        trader.setView(v, settingsRef.current);
        // Sin selección (o con una que ya no existe en el simulador), mostrar el primer gapper.
        const cur = selectedRef.current;
        const known = !!cur && !!src.row(cur);
        if ((!cur || (!server && !known && !firstViewSeen)) && v.scanners.gappers[0]) {
          const sym = v.scanners.gappers[0].sym;
          selectedRef.current = sym;
          setSelected(sym);
          src.select(sym);
        }
        firstViewSeen = true;
      },
      onAlerts: (list, initial) => {
        setAlerts((prev) => {
          const next = initial ? list.slice() : prev.concat(list);
          return next.length > 600 ? next.slice(-600) : next;
        });
        if (!initial) playAlerts(list);
      },
      onNews: (items, initial) => {
        setNews((prev) => {
          const seen = new Set(prev.map((n) => n.id));
          const merged = initial ? items.slice() : [...items.filter((n) => !seen.has(n.id)), ...prev];
          merged.sort((a, b) => b.ts - a.ts);
          return merged.slice(0, 200);
        });
      },
      onDetail: setDetail,
      onStatus: setStatus,
      onTick: (t) => {
        c.onTick(t);
        trader.step(t);
      },
      onCatchUp: (t) => c.catchUp(t),
      onRebuild: () => c.rebase(),
      onAccount: (rev) => void c.reload(rev),
    });
    if (selectedRef.current) src.select(selectedRef.current);
    c.attach(src);
    trader.attach(src);
    setSource(src);
    return () => {
      trader.detach();
      c.detach(src);
      src.stop();
    };
    // La fuente se recrea solo con un día simulado nuevo; ajustes y watchlist se envían aparte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, sim?.key]);

  // Alertas del escáner: un sonido y, para las de momentum, la voz ("V I O. Squeeze. Sube 45 por
  // ciento"). Suena la más importante del grupo y la misma acción no se repite enseguida.
  // Alertas de precio dibujadas en el gráfico: cuando el precio de una acción cruza una de tus líneas
  // con campana, suena, se lee y entra en las alertas (una sola vez por línea).
  const linePriceRef = useRef(new Map<string, number>());
  useEffect(() => {
    const sync = () => c.setExtraTracked(symbolsWithAlerts());
    sync();
    return subscribeDrawings(sync);
  }, [c]);
  function checkLineAlerts(src: DataSource) {
    for (const sym of symbolsWithAlerts()) {
      const r = src.row(sym);
      const price = r?.price;
      if (!price) continue;
      const prev = linePriceRef.current.get(sym);
      linePriceRef.current.set(sym, price);
      if (prev === undefined) continue;
      const now = src.now();
      for (const l of crossAlerts(sym, prev, price, now)) {
        const upward = price >= l.price;
        const a: Alert = {
          id: `line-${sym}-${l.id}`,
          ts: now,
          sym,
          type: 'priceLine',
          text: `Cruzó tu línea de $${l.price >= 1 ? l.price.toFixed(2) : l.price.toFixed(4)} ${upward ? 'hacia arriba' : 'hacia abajo'}`,
          price,
          changePct: r.changePct,
          volume: r.volume,
          rvol: r.rvol,
          score: r.score,
          tone: upward ? 'up' : 'down',
        };
        setAlerts((prev) => [...prev, a].slice(-600));
        playAlerts([a]);
        c.notify(`${sym}: ${a.text}.`, upward ? 'ok' : 'error');
      }
    }
  }
  function playAlerts(list: Alert[]) {
    const p = prefsRef.current;
    if (!p.sound) return;
    const watched = (a: Alert) => watchRef.current.includes(a.sym);
    const cands = list.filter((a) => !a.warmup && p.soundTypes.includes(a.type) && (a.score >= p.soundMinScore || watched(a)));
    if (!cands.length) return;
    cands.sort((x, y) => (ALERT_PRIORITY[y.type] ?? 0) - (ALERT_PRIORITY[x.type] ?? 0) || y.score - x.score);
    const a = cands[0];
    beep(a);
    if (!p.voice || !(VOICE_TYPES.has(a.type) || (a.type === 'news' && watched(a)))) return;
    const t = performance.now();
    const urgent = a.type === 'halt' || a.type === 'resume';
    if (!urgent && (t - (spokenAt.current.get(a.sym) ?? -Infinity) < VOICE_COOLDOWN_MS || t - lastVoice.current < 2500)) return;
    spokenAt.current.set(a.sym, t);
    lastVoice.current = t;
    speak(a, p.voiceLang);
  }

  // Aviso de cada ejecución de práctica y sonidos de las órdenes (aparte del sonido de las alertas).
  useEffect(() => c.onFill(({ fill, trade }) => c.notify(c.describeFill(fill, trade), trade ? (trade.net >= 0 ? 'ok' : 'error') : 'ok')), [c]);
  useEffect(() => c.onSound(playOrder), [c]);

  // Celular o escritorio: el diario va en una pestaña o en una ventana, nunca los dos a la vez.
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 899px)');
    if (!mq) return;
    const f = () => setIsMobile(mq.matches);
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, []);

  // Guardar el punto de reanudación al salir o pasar a segundo plano.
  useEffect(() => {
    const flush = () => document.visibilityState === 'hidden' && c.persistNow();
    const hide = () => c.persistNow();
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', hide);
    };
  }, [c]);

  // Reloj de la interfaz: la hora del mercado (simulado o del servidor). Lo leen solo los componentes
  // que muestran la hora o una cuenta regresiva (ver lib/now.ts).
  useEffect(() => {
    setClock(source ? () => source.now() : null);
    return () => setClock(null);
  }, [source]);

  // Tema: respeta el del sistema/visor salvo que el usuario elija uno en la app.
  useEffect(() => {
    if (prefs.theme !== 'system') document.documentElement.setAttribute('data-theme', prefs.theme);
    setTheme(effectiveThemeNow());
  }, [prefs.theme]);
  useEffect(() => {
    const update = () => setTheme(effectiveThemeNow());
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener?.('change', update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq?.removeEventListener?.('change', update);
      obs.disconnect();
    };
  }, []);

  // El audio solo se habilita después de un toque del usuario (iOS/Safari); con el primero alcanza.
  useEffect(() => {
    const off = () => {
      window.removeEventListener('pointerdown', f);
      window.removeEventListener('keydown', f);
    };
    const f = () => {
      unlockAudio();
      setAudioLocked(false);
      off();
    };
    window.addEventListener('pointerdown', f);
    window.addEventListener('keydown', f);
    return off;
  }, []);

  // Atajos de teclado configurables (Ajustes de la cuenta → Atajos). No actúan mientras escribís en
  // un campo, con una ventana abierta (Esc la cierra) ni al mantener apretada la tecla.
  const runHotkey = useCallback(
    (h: Hotkey) => {
      const sym = selectedRef.current;
      if (!sym) return;
      const t = ticketRef.current;
      c.hotkey(h, sym, {
        shares: Math.floor(Number(t.shares) || 0),
        stop: num(t.stop),
        target: num(t.target),
        setup: t.setup,
        route: t.route,
        tif: t.tif,
      });
    },
    [c],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || typing(e.target)) return;
      if (document.querySelector('.modal-back, .journal-overlay')) return;
      const h = c.state.settings.hotkeys.find((x) => matches(x, e));
      if (!h) return;
      e.preventDefault();
      runHotkey(h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c, runHotkey]);

  const select = useCallback(
    (sym: string) => {
      sym = sym.toUpperCase();
      setSelected(sym);
      selectedRef.current = sym;
      save(`selected${keySuffix}`, sym);
      source?.select(sym);
      setShowJournal(false);
      if (window.matchMedia?.('(max-width: 899px)').matches) {
        setMobileTab('chart');
        window.scrollTo({ top: 0 });
      } else {
        // En pantallas medianas la página se desplaza: volver al gráfico y al ticket si quedaron fuera de vista.
        const chart = document.querySelector('.p-l2');
        const r = chart?.getBoundingClientRect();
        if (r && (r.bottom < 120 || r.top > window.innerHeight - 120)) window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [source, keySuffix],
  );
  selectRef.current = select;

  // Callbacks estables: los paneles memorizados (escáner, alertas, Nivel 2, gráficos) no se vuelven a
  // dibujar si no cambió lo que muestran.
  const updateWatch = useCallback(
    (next: string[]) => {
      watchRef.current = next;
      setWatch(next);
      save(`watch${keySuffix}`, next);
      source?.setWatchlist(next);
    },
    [source, keySuffix],
  );
  const toggleWatch = useCallback(
    (sym: string) => {
      const cur = watchRef.current;
      updateWatch(cur.includes(sym) ? cur.filter((s) => s !== sym) : [...cur, sym]);
    },
    [updateWatch],
  );
  const removeWatch = useCallback((sym: string) => updateWatch(watchRef.current.filter((x) => x !== sym)), [updateWatch]);
  const addWatch = useCallback(
    (sym: string) => {
      if (!watchRef.current.includes(sym)) updateWatch([...watchRef.current, sym]);
    },
    [updateWatch],
  );

  const updatePrefs = useCallback((p: Partial<Prefs>) => {
    if (p.sound) unlockAudio();
    const next = { ...prefsRef.current, ...p };
    prefsRef.current = next;
    setPrefs(next);
    save('prefs', next);
  }, []);

  const setTab = useCallback((slot: string, id: string) => {
    setTabs((cur) => {
      const next = { ...cur, [slot]: id };
      save('tabs', next);
      return next;
    });
  }, []);

  const openAnyDay = useCallback(() => setNewDay('any'), []);
  const openPractice = useCallback(() => setPracticeSettings(true), []);
  const search = useCallback((q: string) => (source ? source.search(q) : Promise.resolve([] as string[])), [source]);

  const knownSyms = useMemo(() => {
    const set = new Set<string>();
    if (view) for (const rows of Object.values(view.scanners)) for (const r of rows) set.add(r.sym);
    return set;
  }, [view]);
  const known = useCallback((s: string) => knownSyms.has(s) || watch.includes(s), [knownSyms, watch]);

  // Posición, ejecuciones y órdenes de la acción elegida, con la misma referencia mientras no cambien.
  const pos = selected ? c.broker?.position(selected) : undefined;
  const chartPos = useStable<ChartPosition | undefined>(pos ? { avgCost: pos.avgCost, shares: pos.shares, stop: pos.stop, target: pos.target, planStop: pos.planStop, planTarget: pos.planTarget } : undefined);
  const chartFills = useStable<ChartFill[] | undefined>(
    selected ? c.active?.fills.filter((f) => f.sym === selected).map((f) => ({ ts: f.ts, side: f.side, price: f.price, shares: f.shares })) : undefined,
  );
  const chartOrders = useStable<ChartOrder[] | undefined>(
    selected
      ? c.broker
          ?.orders(selected)
          .filter((o) => o.role !== 'stop' && o.role !== 'target')
          .map((o) => ({ side: o.side, price: o.price ?? o.stopPrice ?? 0, shares: o.shares - o.filled, kind: o.type === 'stop' ? 'stop' : 'limit' }))
      : undefined,
  );

  const newDayDialog = newDay && <NewDayDialog c={c} initialMode={newDay === 'any' ? undefined : newDay} onClose={() => setNewDay(null)} />;
  const journalOverlay = showJournal && (
    <div className="journal-overlay" onClick={() => setShowJournal(false)}>
      <div className="journal-sheet" onClick={(e) => e.stopPropagation()}>
        <Journal c={c} onClose={() => setShowJournal(false)} onSelect={select} onSettings={() => setPracticeSettings(true)} onNewDay={() => setNewDay('any')} />
      </div>
    </div>
  );

  if (!view && closedUntil !== null && !sim) {
    // Nunca hubo mercado en esta carga (por ejemplo, un sábado en "Mercado ahora").
    return (
      <div className="boot">
        <MarketClosed until={closedUntil} onPractice={() => setNewDay('practice')} onJournal={() => setShowJournal(true)} onNewDay={() => setNewDay('any')} />
        {newDayDialog}
        {journalOverlay}
        {practiceSettings && <PracticeSettings c={c} onClose={() => setPracticeSettings(false)} />}
        {c.notices.length > 0 && (
          <div className="toasts" role="status" aria-live="polite">
            {c.notices.map((n) => (
              <div key={n.id} className={`toast ${n.tone}`}>
                {n.text}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (!view) return <BootScreen message={status?.message ?? 'Buscando el servidor de datos…'} />;

  const sc = view.scanners;
  const activeHalts = view.halts.filter((h) => h.halted).length;
  const quote = selected && source ? source.quote(selected) : null;
  const acct = c.summary();
  const openOrders = c.active?.orders.length ?? 0;
  const scanIds: ScannerId[] = ['gappers', 'pillars', 'running', 'lowFloat', 'rvol', 'fades'];
  const scanTab = tabs.scan ?? 'gappers';
  const momoTab = tabs.momo ?? 'momentum';
  const quoteTab = tabs.quote ?? 'quote';
  const acctTab = tabs.acct ?? 'pos';
  const openJournal = () => {
    if (isMobile) {
      setMobileTab('diario');
      window.scrollTo({ top: 0 });
    } else setShowJournal(true);
  };
  const realtime = source instanceof LocalSource && source.realtime;
  // Mercado real (el servidor) o simulador (en esta página), con la misma cuenta de práctica.
  const switchSource = () => {
    const toSim = !!server;
    if (c.active?.positions.length && !window.confirm('Tenés posiciones abiertas en el día actual. Al cambiar, ese día se archiva y las posiciones vuelven al efectivo a su costo. ¿Seguir?')) return;
    save('source', toSim ? 'sim' : 'real');
    const u = new URL(location.href);
    u.searchParams.delete('demo');
    u.searchParams.delete('real');
    u.searchParams.set(toSim ? 'demo' : 'real', '1');
    location.href = u.toString();
  };
  const active = c.active;
  const dayChip =
    c.mode !== 'local'
      ? undefined
      : active?.clock === 'ny'
        ? { label: 'NY ahora', tone: 'live' as const, title: `"Mercado ahora": la hora real de Nueva York${active.heat ? ` · ${HEAT_LABEL[active.heat]}` : ''}. Tocá para elegir otro día.` }
        : active
          ? { label: `Práctica · ${fmtDay(active.dayKey)}`, tone: 'sim' as const, title: `Día de práctica del ${fmtDay(active.dayKey, true)}${active.heat ? ` · ${HEAT_LABEL[active.heat]}: ${HEAT_HINT[active.heat]}` : ''}. Tocá para elegir otro día.` }
          : closedUntil !== null
            ? { label: 'NY cerrado', tone: 'off' as const, title: `Nueva York abre el ${new Date(closedUntil).toLocaleString('es-AR')}. Tocá para practicar otro día.` }
            : { label: 'Nuevo día', tone: 'off' as const, title: 'Elegir el próximo día' };

  const panels: Record<PanelId, ReactNode> = {
    trades: (
      <Panel title="Mis trades" area="trades" mtab={PANEL_TAB.trades} className="p-trades" actions={<DayResult c={c} />}>
        <MyTrades c={c} onSelect={select} />
      </Panel>
    ),
    momo: (
      <Panel
        title="Momentum"
        area="momo"
        mtab={PANEL_TAB.momo}
        help={`Señales de impulso (nuevo máximo del día, squeeze, subida rápida, bull flag, ruptura del máximo pre-market y picos de volumen) en acciones con ${prefs.momentumMinScore} o más pilares. El color de la fila: 5 pilares magenta, 4 celeste, 3 azul. Se resaltan float bajo, volumen relativo de 5x y suba de 10% o más.`}
        tabs={[
          { id: 'momentum', label: 'Máximos del día' },
          { id: 'alerts', label: 'Alertas' },
          { id: 'halts', label: 'Halts', count: activeHalts || undefined },
          { id: 'ia', label: 'IA Trader', count: trader.state.suggestion ? 1 : undefined },
        ]}
        activeTab={momoTab}
        onTab={(id) => setTab('momo', id)}
        actions={
          <button
            type="button"
            className={`chip voice-chip ${prefs.sound && prefs.voice ? 'is-active' : ''}`}
            onClick={() => updatePrefs(prefs.sound && prefs.voice ? { voice: false } : { sound: true, voice: true })}
            aria-pressed={prefs.sound && prefs.voice}
            title={prefs.sound && prefs.voice ? 'Alertas con voz prendidas: tocá para apagar la voz' : 'Prender las alertas con sonido y voz'}
          >
            <IconVoice /> <span className="vc-label">Voz</span>
          </button>
        }
      >
        {momoTab === 'momentum' && <MomentumFeed alerts={alerts} minScore={prefs.momentumMinScore} selected={selected} onSelect={select} />}
        {momoTab === 'alerts' && <AlertFeed alerts={alerts} selected={selected} onSelect={select} />}
        {momoTab === 'halts' && <HaltsPanel halts={view.halts} selected={selected} onSelect={select} />}
        {momoTab === 'ia' && <AiTraderPanel trader={trader} selected={selected} onSelect={select} />}
      </Panel>
    ),
    scan: (
      <Panel
        title="Escáneres"
        area="scan"
        mtab={PANEL_TAB.scan}
        help={scanIds.includes(scanTab as ScannerId) ? scannerHelp(scanTab as ScannerId, settings) : 'Tus símbolos marcados con la estrella y dónde está el precio dentro del rango del día.'}
        tabs={[
          ...scanIds.map((id) => ({ id, label: SCANNER_LABEL[id], count: sc[id].length })),
          { id: 'watch', label: 'Watchlist', count: watch.length || undefined },
          { id: 'hod', label: 'Rango del día' },
        ]}
        activeTab={scanTab}
        onTab={(id) => setTab('scan', id)}
      >
        {scanIds.includes(scanTab as ScannerId) &&
          (sc[scanTab as ScannerId].length ? (
            <ScannerTable rows={sc[scanTab as ScannerId]} columns={SCANNER_COLUMNS[scanTab as ScannerId]} selected={selected} onSelect={select} sortKey={scanTab} />
          ) : (
            <Empty>Nada cumple este criterio por ahora.</Empty>
          ))}
        {scanTab === 'watch' && (
          <WatchlistPanel rows={view.watch} watch={watch} selected={selected} onSelect={select} onRemove={removeWatch} onAdd={addWatch} />
        )}
        {scanTab === 'hod' && <HodBoard rows={view.hodBoard} selected={selected} onSelect={select} />}
      </Panel>
    ),
    l2: (
      <Panel
        title="Nivel 2 y órdenes"
        area="l2"
        mtab={PANEL_TAB.l2}
        className="p-l2"
        help="Libro por venues (un color por nivel de precio), cinta de operaciones y ticket. Tocá un precio del libro para usarlo. Las órdenes tardan unos milisegundos en llegar y se ejecutan contra el libro; las límite esperan su turno en la cola."
      >
        <Level2 c={c} source={source} detail={detail} quote={quote} ticket={ticket} setTicket={setTicket} onSymbol={select} search={search} onHotkey={runHotkey} compact={isMobile} onNewDay={openAnyDay} />
      </Panel>
    ),
    quote: (
      <Panel
        title="Cotización"
        area="quote"
        mtab={PANEL_TAB.quote}
        className="p-quote"
        tabs={[
          { id: 'quote', label: selected ? `Cotización · ${selected}` : 'Cotización' },
          { id: 'news', label: 'Noticias' },
        ]}
        activeTab={quoteTab}
        onTab={(id) => setTab('quote', id)}
      >
        {quoteTab === 'quote' &&
          (selected && !detail ? <Empty>Sin datos para {selected} todavía.</Empty> : <Detail detail={detail} settings={settings} watched={!!detail && watch.includes(detail.sym)} onToggleWatch={toggleWatch} />)}
        {quoteTab === 'news' && <NewsPanel news={news} onSelect={select} known={known} />}
      </Panel>
    ),
    chart1: (
      <Panel title="Gráfico 1 min" area="chart1" mtab={PANEL_TAB.chart1} className="p-chart p-chart1">
        <Chart id="a" defaultTf={60} detail={detail} alerts={alerts} themeKey={theme} position={chartPos} fills={chartFills} orders={chartOrders} loadHistory={loadHistory} />
      </Panel>
    ),
    chart5: (
      <Panel title="Gráfico 5 min" area="chart5" mtab={PANEL_TAB.chart5} className="p-chart p-chart5">
        <Chart id="b" defaultTf={300} detail={detail} alerts={alerts} themeKey={theme} position={chartPos} fills={chartFills} orders={chartOrders} loadHistory={loadHistory} />
      </Panel>
    ),
    pos: (
      <Panel
        title="Posiciones"
        area="pos"
        mtab={PANEL_TAB.pos}
        className="p-pos"
        tabs={[
          { id: 'pos', label: 'Posiciones', count: c.active?.positions.length || undefined },
          { id: 'trades', label: 'Trades de hoy', count: c.active?.trades.length || undefined },
          { id: 'acct', label: 'Cuenta' },
        ]}
        activeTab={acctTab}
        onTab={(id) => setTab('acct', id)}
      >
        {acctTab === 'trades' ? (
          <TodayTrades c={c} onSelect={select} />
        ) : acctTab === 'acct' ? (
          <AccountValue c={c} onSettings={openPractice} />
        ) : (
          <PositionsWindow c={c} selected={selected} onSelect={select} />
        )}
      </Panel>
    ),
    orders: (
      <Panel title="Actividad de órdenes" area="orders" mtab={PANEL_TAB.orders} className="p-orders" count={openOrders || undefined}>
        <TradeActivity c={c} onSelect={select} />
      </Panel>
    ),
  };

  return (
    <div className="app" data-tab={mobileTab}>
      {server && view.session === 'closed' && (
        <div className="closed-banner">
          Nueva York está cerrada (abre el {new Date(nyMarket(readNow() || Date.now()).nextOpen).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} hora de Buenos Aires).{' '}
          <button type="button" className="link" onClick={switchSource}>
            Practicar en el simulador
          </button>
        </div>
      )}
      <Header
        session={view.session}
        status={status}
        speed={speed}
        onSpeed={(x) => {
          setSpeed(x);
          source?.setSpeed(x);
        }}
        prefs={prefs}
        onPrefs={updatePrefs}
        onSettings={() => setShowSettings(true)}
        onSearch={select}
        canSpeed={source?.kind === 'local' && !realtime}
        search={search}
        effectiveTheme={theme}
        account={{ equity: acct.equity, dayPnl: acct.dayPnl }}
        onJournal={openJournal}
        layoutEditing={isMobile ? undefined : layoutEdit}
        onLayout={() => setLayoutEdit((x) => !x)}
        day={dayChip}
        sourceSwitch={hasServer ? { sim: !server, onSwitch: switchSource } : undefined}
        onDay={() => setNewDay('any')}
      />

      {isMobile ? (
        // En el celular se monta solo la pestaña que se ve: los otros paneles y gráficos no trabajan de fondo.
        <main className="grid">
          {(Object.keys(panels) as PanelId[])
            .filter((id) => PANEL_TAB[id] === mobileTab)
            .map((id) => (
              <Fragment key={id}>{panels[id]}</Fragment>
            ))}
          {mobileTab === 'diario' && (
            <section className="panel journal-tab" data-tab="diario">
              <Journal c={c} onSelect={select} onSettings={openPractice} onNewDay={openAnyDay} />
            </section>
          )}
        </main>
      ) : (
        <WindowGrid panels={panels} editing={layoutEdit} resetKey={layoutReset} />
      )}
      {layoutEdit && !isMobile && (
        <div className="layout-bar" role="status">
          <span>Mové las ventanas desde su barra de título y cambiales el tamaño desde los bordes y las esquinas.</span>
          <button className="btn" onClick={() => setLayoutReset((x) => x + 1)}>
            Restablecer
          </button>
          <button className="btn primary" onClick={() => setLayoutEdit(false)}>
            Listo
          </button>
        </div>
      )}

      <footer className="statusbar">
        <span className={`dot ${status?.connected ? 'on' : 'off'}`} />
        <span>{status?.message}</span>
        <span className="t-muted">
          {view.stats.tracked.toLocaleString('es-AR')} símbolos · {view.stats.active.toLocaleString('es-AR')} activos · {view.stats.eventsPerSec.toLocaleString('es-AR')} eventos/s
        </span>
        {prefs.sound && audioLocked && (
          <span className="audio-hint" role="note">
            Tocá la pantalla para activar el sonido
            <button type="button" className="audio-hint-close" onClick={() => setAudioLocked(false)} aria-label="Cerrar el aviso">
              ×
            </button>
          </span>
        )}
        <span className="t-muted disclaimer">Herramienta informativa. No es asesoramiento financiero.</span>
      </footer>

      <div className="mobile-dock" ref={dockRef}>
        {isMobile && mobileTab === 'chart' && c.active && c.broker && (
          <MobileTradeBar c={c} sym={selected} quote={quote} row={detail?.sym === selected ? detail.row : undefined} ticket={ticket} setTicket={setTicket} onHotkey={runHotkey} />
        )}
        <MobileTabs
          tab={mobileTab}
          onTab={(t) => {
            setMobileTab(t);
            window.scrollTo({ top: 0 });
          }}
          haltCount={activeHalts}
        />
      </div>

      {c.notices.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {c.notices.map((n) => (
            <div key={n.id} className={`toast ${n.tone}`}>
              {n.text}
            </div>
          ))}
        </div>
      )}

      {!isMobile && journalOverlay}

      {closedUntil !== null && !active && !showJournal && !newDay && !practiceSettings && (
        <div className="closed-overlay">
          <MarketClosed until={closedUntil} onPractice={() => setNewDay('practice')} onJournal={openJournal} onNewDay={() => setNewDay('any')} />
        </div>
      )}

      {newDayDialog}

      {practiceSettings && <PracticeSettings c={c} onClose={() => setPracticeSettings(false)} />}

      {showSettings && (
        <SettingsModal
          settings={settings}
          prefs={prefs}
          onClose={() => setShowSettings(false)}
          onSave={(s, p) => {
            setSettings(s);
            save('settings', s);
            source?.setSettings(s);
            updatePrefs(p);
            setShowSettings(false);
          }}
          onPractice={() => {
            setShowSettings(false);
            setPracticeSettings(true);
          }}
        />
      )}
    </div>
  );
}
