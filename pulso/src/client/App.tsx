import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtVolume } from '../engine/alerts';
import type { Alert, NewsItem, ProviderStatus, ScannerId, Settings, SymbolDetail, ViewModel } from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';
import { createTrainingStore, LocalTrainingStore } from '../trading/store';
import type { Hotkey } from '../trading/types';
import { AccountValue, PositionsWindow, TradeActivity } from './components/Account';
import { Chart, type ChartFill, type ChartOrder, type ChartPosition } from './components/Chart';
import { Header, MobileTabs, SettingsModal, type MobileTab, type Prefs } from './components/Chrome';
import { Detail } from './components/Detail';
import { AlertFeed, HaltsPanel, HodBoard, MomentumFeed, NewsPanel, WatchlistPanel } from './components/Feeds';
import { Journal } from './components/Journal';
import { Level2, num, type TicketForm } from './components/Level2';
import { Empty, Panel } from './components/Panel';
import { PracticeSettings } from './components/PracticeSettings';
import { SCANNER_COLUMNS, ScannerTable } from './components/ScannerTable';
import { DEFAULT_SOUND_TYPES } from './lib/alertMeta';
import { beep, playFill, speak, unlockAudio } from './lib/audio';
import { matches, typing } from './lib/hotkeys';
import { load, save } from './lib/storage';
import { LocalSource, type SimConfig } from './source/local';
import { detectServer, RemoteSource } from './source/remote';
import type { DataSource } from './source/types';
import { TrainingController, useTrainingVersion } from './training';

const DEFAULT_PREFS: Prefs = {
  sound: false,
  voice: false,
  voiceLang: 'es',
  soundMinScore: 3,
  soundTypes: DEFAULT_SOUND_TYPES,
  momentumMinScore: 3,
  theme: 'system',
};

const SCANNER_LABEL: Record<ScannerId, string> = {
  gappers: 'Top gappers',
  pillars: '5 pilares',
  running: 'Subiendo ahora',
  lowFloat: 'Low float',
  rvol: 'Volumen relativo',
  fades: 'Se desinflan',
};

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

/** Arranque: ¿hay servidor de Pulso? ¿dónde se guarda la cuenta de práctica? */
export function App() {
  const [boot, setBoot] = useState<{ server: boolean; c: TrainingController } | null>(null);
  const [msg, setMsg] = useState('Buscando el servidor de datos…');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const server = await detectServer();
      if (!alive) return;
      setMsg('Cargando tu cuenta de práctica…');
      let store = await createTrainingStore();
      let loaded;
      let failed = false;
      try {
        loaded = await store.load();
      } catch {
        // Un error momentáneo de la base: se reintenta una vez.
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
        try {
          loaded = await store.load();
        } catch {
          // Sin la base, se practica en este navegador (con claves propias: no reemplaza la cuenta de Claude).
          failed = store.kind === 'cuenta';
          store = new LocalTrainingStore(failed ? 'pulso:training-sin-cuenta' : 'pulso:training');
          loaded = await store.load();
        }
      }
      if (!alive) return;
      const c = new TrainingController(store, loaded, server ? 'remote' : 'local');
      if (failed) c.notify('No se pudo leer tu cuenta de Claude: esta sesión se guarda solo en este navegador.', 'error');
      setBoot({ server: !!server, c });
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!boot) return <BootScreen message={msg} />;
  return <Workspace server={boot.server} c={boot.c} />;
}

function Workspace({ server, c }: { server: boolean; c: TrainingController }) {
  useTrainingVersion(c);
  const [source, setSource] = useState<DataSource | null>(null);
  const [view, setView] = useState<ViewModel | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [detail, setDetail] = useState<SymbolDetail | null>(null);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => load('settings', DEFAULT_SETTINGS));
  const [watch, setWatch] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(() => load('prefs', DEFAULT_PREFS));
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
    shares: String(c.state.settings.defaultShares),
    route: 'SMRT',
    tif: c.state.settings.defaultTif,
    bracket: load('ticket-bracket', true),
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
      if (patch.bracket !== undefined) save('ticket-bracket', next.bracket);
      if (patch.setup !== undefined) save('ticket-setup', next.setup);
      return next;
    });
  }, []);
  const [isMobile, setIsMobile] = useState(() => !!window.matchMedia?.('(max-width: 899px)').matches);
  const [now, setNow] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => effectiveThemeNow());
  // La fuente del simulador se recrea solo cuando empieza un día nuevo (otra semilla).
  const [sim, setSim] = useState<SimConfig | undefined>(() => c.simConfig);

  const keySuffix = server ? '' : '-demo';
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
        const next = c.simConfig;
        if (next && next.seed !== sim?.seed) setSim(next);
      }),
    [c, sim?.seed],
  );

  // Fuente de datos: servidor de Pulso (en vivo) o simulador local con la semilla del día de práctica.
  useEffect(() => {
    if (!server && !sim) return;
    // Un día simulado nuevo trae otras acciones: la watchlist y la selección del día anterior no sirven.
    if (!server && lastSeedRef.current !== undefined && lastSeedRef.current !== sim?.seed) {
      save('watch-demo', []);
      save('selected-demo', null);
    }
    lastSeedRef.current = sim?.seed;
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
    const src: DataSource = server ? new RemoteSource(settings, savedWatch) : new LocalSource(settings, savedWatch, sim!);
    src.start({
      onView: (v) => {
        setView(v);
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
      onTick: (t) => c.onTick(t),
    });
    if (selectedRef.current) src.select(selectedRef.current);
    c.attach(src);
    setSource(src);
    return () => {
      c.detach(src);
      src.stop();
    };
    // La fuente se recrea solo con un día simulado nuevo; ajustes y watchlist se envían aparte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, sim?.seed]);

  function playAlerts(list: Alert[]) {
    const p = prefsRef.current;
    if (!p.sound) return;
    for (const a of list) {
      if (a.warmup) continue;
      const watched = watchRef.current.includes(a.sym);
      if (!p.soundTypes.includes(a.type)) continue;
      if (a.score < p.soundMinScore && !watched) continue;
      beep(a);
      if (p.voice) speak(a, p.voiceLang);
      break;
    }
  }

  // Aviso y sonido de cada ejecución de práctica.
  useEffect(
    () =>
      c.onFill(({ fill, trade }) => {
        c.notify(c.describeFill(fill, trade), trade ? (trade.net >= 0 ? 'ok' : 'error') : 'ok');
        if (!prefsRef.current.sound) return;
        if (fill.side === 'buy') playFill('buy');
        else if (trade) playFill(trade.net >= 0 ? 'win' : 'loss');
        else playFill('sell');
      }),
    [c],
  );

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

  // Reloj del encabezado.
  useEffect(() => {
    if (!source) return;
    const id = setInterval(() => setNow(source.now()), 250);
    return () => clearInterval(id);
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

  // El audio solo se habilita después de un toque del usuario (iOS/Safari).
  useEffect(() => {
    const f = () => unlockAudio();
    window.addEventListener('pointerdown', f);
    window.addEventListener('keydown', f);
    return () => {
      window.removeEventListener('pointerdown', f);
      window.removeEventListener('keydown', f);
    };
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
        stop: t.bracket ? num(t.stop) : undefined,
        target: t.bracket ? num(t.target) : undefined,
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

  const updateWatch = (next: string[]) => {
    setWatch(next);
    save(`watch${keySuffix}`, next);
    source?.setWatchlist(next);
  };
  const toggleWatch = (sym: string) => updateWatch(watch.includes(sym) ? watch.filter((s) => s !== sym) : [...watch, sym]);

  const updatePrefs = (p: Partial<Prefs>) => {
    if (p.sound) unlockAudio();
    const next = { ...prefs, ...p };
    setPrefs(next);
    save('prefs', next);
  };

  const setTab = (slot: string, id: string) => {
    const next = { ...tabs, [slot]: id };
    setTabs(next);
    save('tabs', next);
  };

  const knownSyms = useMemo(() => {
    const set = new Set<string>();
    if (view) for (const rows of Object.values(view.scanners)) for (const r of rows) set.add(r.sym);
    return set;
  }, [view]);

  if (!view) return <BootScreen message={status?.message ?? 'Buscando el servidor de datos…'} />;

  const sc = view.scanners;
  const activeHalts = view.halts.filter((h) => h.halted).length;
  const quote = selected && source ? source.quote(selected) : null;
  const pos = selected ? c.broker?.position(selected) : undefined;
  const chartPos: ChartPosition | undefined = pos ? { avgCost: pos.avgCost, shares: pos.shares, stop: pos.stop, target: pos.target } : undefined;
  const chartFills: ChartFill[] | undefined = selected
    ? c.active?.fills.filter((f) => f.sym === selected).map((f) => ({ ts: f.ts, side: f.side, price: f.price, shares: f.shares }))
    : undefined;
  const chartOrders: ChartOrder[] | undefined = selected
    ? c.broker
        ?.orders(selected)
        .filter((o) => o.role !== 'stop' && o.role !== 'target')
        .map((o) => ({ side: o.side, price: o.price ?? o.stopPrice ?? 0, shares: o.shares - o.filled, kind: o.type === 'stop' ? 'stop' : 'limit' }))
    : undefined;
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
  const search = source ? source.search.bind(source) : async () => [];

  return (
    <div className="app" data-tab={mobileTab}>
      <Header
        now={now}
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
        canSpeed={source?.kind === 'local'}
        search={search}
        effectiveTheme={theme}
        account={{ equity: acct.equity, dayPnl: acct.dayPnl }}
        onJournal={openJournal}
      />

      <main className="grid">
        <Panel
          title="Momentum"
          area="momo"
          mtab="momo"
          help={`Señales de impulso (nuevo máximo del día, squeeze, subida rápida, bull flag, ruptura del máximo pre-market y picos de volumen) en acciones con ${prefs.momentumMinScore} o más pilares. El color de la fila: 5 pilares magenta, 4 celeste, 3 azul. Se resaltan float bajo, volumen relativo de 5x y suba de 10% o más.`}
          tabs={[
            { id: 'momentum', label: 'Máximos del día' },
            { id: 'alerts', label: 'Alertas' },
            { id: 'halts', label: 'Halts', count: activeHalts || undefined },
          ]}
          activeTab={momoTab}
          onTab={(id) => setTab('momo', id)}
        >
          {momoTab === 'momentum' && <MomentumFeed alerts={alerts} minScore={prefs.momentumMinScore} selected={selected} onSelect={select} />}
          {momoTab === 'alerts' && <AlertFeed alerts={alerts} selected={selected} onSelect={select} />}
          {momoTab === 'halts' && <HaltsPanel halts={view.halts} now={now} selected={selected} onSelect={select} />}
        </Panel>

        <Panel
          title="Escáneres"
          area="scan"
          mtab="scan"
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
              <ScannerTable rows={sc[scanTab as ScannerId]} columns={SCANNER_COLUMNS[scanTab as ScannerId]} selected={selected} onSelect={select} />
            ) : (
              <Empty>Nada cumple este criterio por ahora.</Empty>
            ))}
          {scanTab === 'watch' && (
            <WatchlistPanel rows={view.watch} watch={watch} selected={selected} onSelect={select} onRemove={(s) => updateWatch(watch.filter((x) => x !== s))} onAdd={(s) => !watch.includes(s) && updateWatch([...watch, s])} />
          )}
          {scanTab === 'hod' && <HodBoard rows={view.hodBoard} selected={selected} onSelect={select} />}
        </Panel>

        <Panel
          title="Nivel 2 y órdenes"
          area="l2"
          mtab="chart"
          className="p-l2"
          help="Libro por venues (un color por nivel de precio), cinta de operaciones y ticket. Tocá un precio del libro para usarlo. Las órdenes tardan unos milisegundos en llegar y se ejecutan contra el libro; las límite esperan su turno en la cola."
        >
          <Level2 c={c} source={source} detail={detail} quote={quote} now={now} ticket={ticket} setTicket={setTicket} onSymbol={select} search={search} onHotkey={runHotkey} compact={isMobile} />
        </Panel>

        <Panel
          title="Cotización"
          area="quote"
          mtab="news"
          className="p-quote"
          tabs={[
            { id: 'quote', label: selected ? `Cotización · ${selected}` : 'Cotización' },
            { id: 'news', label: 'Noticias' },
          ]}
          activeTab={quoteTab}
          onTab={(id) => setTab('quote', id)}
        >
          {quoteTab === 'quote' &&
            (selected && !detail ? <Empty>Sin datos para {selected} todavía.</Empty> : <Detail detail={detail} settings={settings} now={now} watched={!!detail && watch.includes(detail.sym)} onToggleWatch={toggleWatch} />)}
          {quoteTab === 'news' && <NewsPanel news={news} now={now} onSelect={select} known={(s) => knownSyms.has(s) || watch.includes(s)} />}
        </Panel>

        <Panel title="Gráfico 1 min" area="chart1" mtab="chart" className="p-chart p-chart1">
          <Chart id="a" defaultTf={60} detail={detail} alerts={alerts} themeKey={theme} now={now} position={chartPos} fills={chartFills} orders={chartOrders} />
        </Panel>
        <Panel title="Gráfico 5 min" area="chart5" mtab="news" className="p-chart p-chart5">
          <Chart id="b" defaultTf={300} detail={detail} alerts={alerts} themeKey={theme} now={now} position={chartPos} fills={chartFills} orders={chartOrders} />
        </Panel>

        <Panel
          title="Posiciones"
          area="pos"
          mtab="chart"
          className="p-pos"
          tabs={[
            { id: 'pos', label: 'Posiciones', count: c.active?.positions.length || undefined },
            { id: 'acct', label: 'Valor de la cuenta' },
          ]}
          activeTab={acctTab}
          onTab={(id) => setTab('acct', id)}
        >
          {acctTab === 'pos' ? <PositionsWindow c={c} selected={selected} onSelect={select} /> : <AccountValue c={c} onSettings={() => setPracticeSettings(true)} />}
        </Panel>
        <Panel title="Actividad de órdenes" area="orders" mtab="chart" className="p-orders" count={openOrders || undefined}>
          <TradeActivity c={c} onSelect={select} />
        </Panel>

        {isMobile && (
          <section className="panel journal-tab" data-tab="diario">
            <Journal c={c} onSelect={select} onSettings={() => setPracticeSettings(true)} />
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span className={`dot ${status?.connected ? 'on' : 'off'}`} />
        <span>{status?.message}</span>
        <span className="t-muted">
          {view.stats.tracked.toLocaleString('es-AR')} símbolos · {view.stats.active.toLocaleString('es-AR')} activos · {view.stats.eventsPerSec.toLocaleString('es-AR')} eventos/s
        </span>
        <span className="t-muted disclaimer">Herramienta informativa. No es asesoramiento financiero.</span>
      </footer>

      <MobileTabs
        tab={mobileTab}
        onTab={(t) => {
          setMobileTab(t);
          window.scrollTo({ top: 0 });
        }}
        haltCount={activeHalts}
      />

      {c.notices.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {c.notices.map((n) => (
            <div key={n.id} className={`toast ${n.tone}`}>
              {n.text}
            </div>
          ))}
        </div>
      )}

      {showJournal && !isMobile && (
        <div className="journal-overlay" onClick={() => setShowJournal(false)}>
          <div className="journal-sheet" onClick={(e) => e.stopPropagation()}>
            <Journal c={c} onClose={() => setShowJournal(false)} onSelect={select} onSettings={() => setPracticeSettings(true)} />
          </div>
        </div>
      )}

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
