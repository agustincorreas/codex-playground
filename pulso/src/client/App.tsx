import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtVolume } from '../engine/alerts';
import type { Alert, NewsItem, ProviderStatus, ScannerId, Settings, SymbolDetail, ViewModel } from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';
import { createTrainingStore, LocalTrainingStore } from '../trading/store';
import { Chart, type ChartFill, type ChartPosition } from './components/Chart';
import { Header, MobileTabs, SettingsModal, type MobileTab, type Prefs } from './components/Chrome';
import { Detail } from './components/Detail';
import { AlertFeed, HaltsPanel, HodBoard, MomentumFeed, NewsPanel, WatchlistPanel } from './components/Feeds';
import { Journal } from './components/Journal';
import { Empty, Panel } from './components/Panel';
import { OrdersList, PositionsList } from './components/Positions';
import { SCANNER_COLUMNS, ScannerTable } from './components/ScannerTable';
import { Ticket } from './components/Ticket';
import { DEFAULT_SOUND_TYPES } from './lib/alertMeta';
import { beep, playFill, speak, unlockAudio } from './lib/audio';
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
      try {
        loaded = await store.load();
      } catch {
        store = new LocalTrainingStore();
        loaded = await store.load();
      }
      if (!alive) return;
      setBoot({ server: !!server, c: new TrainingController(store, loaded, server ? 'remote' : 'local') });
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
  const [tabs, setTabs] = useState<Record<string, string>>(() => load('tabs', { a: 'running', b: 'lowFloat', p: 'pos' }));
  const [speed, setSpeed] = useState(1);
  const [mobileTab, setMobileTab] = useState<MobileTab>('scan');
  const [showSettings, setShowSettings] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
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

  // Sonido de cada ejecución de práctica.
  useEffect(
    () =>
      c.onFill(({ fill, trade }) => {
        if (!prefsRef.current.sound) return;
        if (fill.side === 'buy') playFill('buy');
        else if (trade) playFill(trade.net >= 0 ? 'win' : 'loss');
        else playFill('sell');
      }),
    [c],
  );

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

  // Atajos de teclado para operar rápido: S vende todo, H vende la mitad, Esc cancela órdenes (B, en el ticket).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const sym = selectedRef.current;
      if (!sym || !c.broker) return;
      const k = e.key.toLowerCase();
      if (k === 's' && c.broker.position(sym)) c.sell(sym, 1);
      else if (k === 'h' && c.broker.position(sym)) c.sell(sym, 0.5);
      else if (e.key === 'Escape' && c.broker.orders(sym).length) c.cancelAll(sym);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c]);

  const select = useCallback(
    (sym: string) => {
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
        const chart = document.querySelector('.p-chart');
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
  const acct = c.summary();
  const openOrders = c.active?.orders.length ?? 0;

  const scannerPanel = (slot: 'a' | 'b', ids: ScannerId[], area: string) => {
    const active = (ids.includes(tabs[slot] as ScannerId) ? tabs[slot] : ids[0]) as ScannerId;
    return (
      <Panel
        title={SCANNER_LABEL[active]}
        area={area}
        mtab="scan"
        help={scannerHelp(active, settings)}
        tabs={ids.map((id) => ({ id, label: SCANNER_LABEL[id], count: sc[id].length }))}
        activeTab={active}
        onTab={(id) => setTab(slot, id)}
      >
        {sc[active].length ? <ScannerTable rows={sc[active]} columns={SCANNER_COLUMNS[active]} selected={selected} onSelect={select} /> : <Empty>Nada cumple este criterio por ahora.</Empty>}
      </Panel>
    );
  };
  const pTab = tabs.p ?? 'pos';

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
        search={source ? source.search.bind(source) : async () => []}
        effectiveTheme={theme}
        account={{ equity: acct.equity, dayPnl: acct.dayPnl }}
        onJournal={() => {
          setShowJournal(true);
          setMobileTab('diario');
        }}
      />

      <main className="grid">
        <Panel title={detail ? `Gráfico · ${detail.sym}` : 'Gráfico'} area="chart" mtab="chart" className="p-chart">
          <Chart detail={detail} alerts={alerts} themeKey={theme} position={chartPos} fills={chartFills} />
        </Panel>
        <Panel title={selected ? `Operar · ${selected}` : 'Operar'} area="detail" mtab="chart" help="Cuenta de práctica con dinero ficticio. Comprá y vendé con el ticket; la ficha de la acción sigue abajo.">
          <Ticket c={c} detail={detail} quote={quote} />
          {selected && !detail ? <Empty>Sin datos para {selected} todavía.</Empty> : <Detail detail={detail} settings={settings} now={now} watched={!!detail && watch.includes(detail.sym)} onToggleWatch={toggleWatch} />}
        </Panel>
        <Panel
          title="Momentum"
          area="momo"
          mtab="momo"
          help={`Señales de impulso (nuevo máximo del día, squeeze, subida rápida, bull flag, ruptura del máximo pre-market y picos de volumen) en acciones con ${prefs.momentumMinScore} o más pilares. La más nueva arriba.`}
        >
          <MomentumFeed alerts={alerts} minScore={prefs.momentumMinScore} selected={selected} onSelect={select} />
        </Panel>
        <Panel title="Halts" area="halts" mtab="momo" count={activeHalts || undefined} help="Halts y reanudaciones del día. Las pausas por volatilidad (LULD) duran 5 minutos; al reanudar se compara contra el precio del halt.">
          <HaltsPanel halts={view.halts} now={now} selected={selected} onSelect={select} />
        </Panel>
        <Panel title="Top gappers" area="gappers" mtab="scan" count={sc.gappers.length} help={scannerHelp('gappers', settings)}>
          {sc.gappers.length ? <ScannerTable rows={sc.gappers} columns={SCANNER_COLUMNS.gappers} selected={selected} onSelect={select} /> : <Empty>Ningún gapper con estos criterios.</Empty>}
        </Panel>
        <Panel title="5 pilares" area="pillars" mtab="scan" count={sc.pillars.length} help={scannerHelp('pillars', settings)}>
          {sc.pillars.length ? <ScannerTable rows={sc.pillars} columns={SCANNER_COLUMNS.pillars} selected={selected} onSelect={select} /> : <Empty>Ninguna acción cumple {settings.pillarsMinScore} pilares todavía.</Empty>}
        </Panel>
        {scannerPanel('a', ['running', 'rvol'], 'scanA')}
        {scannerPanel('b', ['lowFloat', 'fades'], 'scanB')}
        <Panel title="Alertas" area="alerts" mtab="momo" help="Todas las alertas del motor. Filtrá por tipo o por cantidad de pilares.">
          <AlertFeed alerts={alerts} selected={selected} onSelect={select} />
        </Panel>
        <Panel title="Noticias" area="news" mtab="news" help="Titulares en tiempo real. Tocá un símbolo para ver su ficha.">
          <NewsPanel news={news} now={now} onSelect={select} known={(s) => knownSyms.has(s) || watch.includes(s)} />
        </Panel>
        <Panel
          title="Posiciones"
          area="watch"
          mtab="chart"
          tabs={[
            { id: 'pos', label: 'Posiciones', count: c.active?.positions.length || undefined },
            { id: 'ord', label: 'Órdenes', count: openOrders || undefined },
            { id: 'watch', label: 'Watchlist', count: watch.length || undefined },
          ]}
          activeTab={pTab}
          onTab={(id) => setTab('p', id)}
        >
          {pTab === 'pos' && <PositionsList c={c} selected={selected} onSelect={select} />}
          {pTab === 'ord' && <OrdersList c={c} onSelect={select} />}
          {pTab === 'watch' && (
            <WatchlistPanel rows={view.watch} watch={watch} selected={selected} onSelect={select} onRemove={(s) => updateWatch(watch.filter((x) => x !== s))} onAdd={(s) => !watch.includes(s) && updateWatch([...watch, s])} />
          )}
        </Panel>
        <Panel title="Rango del día" area="hod" mtab="scan" help="Dónde está el precio dentro del rango del día (mínimo a máximo) en los principales gappers. La marca vertical es el VWAP.">
          <HodBoard rows={view.hodBoard} selected={selected} onSelect={select} />
        </Panel>
        <section className="panel journal-tab" data-tab="diario">
          <Journal c={c} onSelect={select} />
        </section>
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

      {showJournal && (
        <div className="journal-overlay" onClick={() => setShowJournal(false)}>
          <div className="journal-sheet" onClick={(e) => e.stopPropagation()}>
            <Journal c={c} onClose={() => setShowJournal(false)} onSelect={select} />
          </div>
        </div>
      )}

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
        />
      )}
    </div>
  );
}
