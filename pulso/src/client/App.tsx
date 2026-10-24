import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtVolume } from '../engine/alerts';
import type { Alert, NewsItem, ProviderStatus, ScannerId, Settings, SymbolDetail, ViewModel } from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';
import { Chart } from './components/Chart';
import { Header, MobileTabs, SettingsModal, type MobileTab, type Prefs } from './components/Chrome';
import { Detail } from './components/Detail';
import { AlertFeed, HaltsPanel, HodBoard, MomentumFeed, NewsPanel, WatchlistPanel } from './components/Feeds';
import { Empty, Panel } from './components/Panel';
import { SCANNER_COLUMNS, ScannerTable } from './components/ScannerTable';
import { DEFAULT_SOUND_TYPES } from './lib/alertMeta';
import { beep, speak, unlockAudio } from './lib/audio';
import { load, save } from './lib/storage';
import { LocalSource } from './source/local';
import { detectServer, RemoteSource } from './source/remote';
import type { DataSource } from './source/types';

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

export function App() {
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
  const [tabs, setTabs] = useState<Record<string, string>>(() => load('tabs', { a: 'running', b: 'lowFloat' }));
  const [speed, setSpeed] = useState(1);
  const [mobileTab, setMobileTab] = useState<MobileTab>('scan');
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => effectiveThemeNow());

  // El demo y el modo en vivo guardan su watchlist y su selección por separado.
  const keyRef = useRef('');
  const prefsRef = useRef(prefs);
  const watchRef = useRef(watch);
  const selectedRef = useRef(selected);
  prefsRef.current = prefs;
  watchRef.current = watch;
  selectedRef.current = selected;

  // Elegir la fuente: servidor de Pulso (en vivo) o simulador local (demo).
  useEffect(() => {
    let src: DataSource | null = null;
    let cancelled = false;
    let firstViewSeen = false;
    void detectServer().then((server) => {
      if (cancelled) return;
      keyRef.current = server ? '' : '-demo';
      const savedWatch = load<string[]>(`watch${keyRef.current}`, []);
      const savedSel = load<string | null>(`selected${keyRef.current}`, null);
      watchRef.current = savedWatch;
      selectedRef.current = savedSel;
      setWatch(savedWatch);
      setSelected(savedSel);
      src = server ? new RemoteSource(settings, savedWatch) : new LocalSource(settings, savedWatch);
      src.start({
        onView: (v) => {
          setView(v);
          // Sin selección (o con una que ya no existe en el demo), mostrar el primer gapper.
          const known = selectedRef.current && (v.watch.some((r) => r.sym === selectedRef.current) || Object.values(v.scanners).some((rows) => rows.some((r) => r.sym === selectedRef.current)));
          if ((!selectedRef.current || (src?.kind === 'local' && !known && !firstViewSeen)) && v.scanners.gappers[0]) {
            const sym = v.scanners.gappers[0].sym;
            selectedRef.current = sym;
            setSelected(sym);
            src?.select(sym);
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
      });
      if (selectedRef.current) src.select(selectedRef.current);
      setSource(src);
    });
    return () => {
      cancelled = true;
      src?.stop();
    };
    // La fuente se crea una sola vez; los cambios posteriores se envían con setSettings/setWatchlist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const select = useCallback(
    (sym: string) => {
      setSelected(sym);
      save(`selected${keyRef.current}`, sym);
      source?.select(sym);
      if (window.matchMedia?.('(max-width: 899px)').matches) {
        setMobileTab('chart');
        window.scrollTo({ top: 0 });
      }
    },
    [source],
  );

  const updateWatch = (next: string[]) => {
    setWatch(next);
    save(`watch${keyRef.current}`, next);
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

  const sc = view?.scanners;
  const activeHalts = view?.halts.filter((h) => h.halted).length ?? 0;
  const scannerPanel = (slot: 'a' | 'b', ids: ScannerId[], area: string) => {
    const active = (ids.includes(tabs[slot] as ScannerId) ? tabs[slot] : ids[0]) as ScannerId;
    return (
      <Panel
        title={SCANNER_LABEL[active]}
        area={area}
        mtab="scan"
        help={scannerHelp(active, settings)}
        tabs={ids.map((id) => ({ id, label: SCANNER_LABEL[id], count: sc?.[id].length }))}
        activeTab={active}
        onTab={(id) => setTab(slot, id)}
      >
        {sc && sc[active].length ? <ScannerTable rows={sc[active]} columns={SCANNER_COLUMNS[active]} selected={selected} onSelect={select} /> : <Empty>Nada cumple este criterio por ahora.</Empty>}
      </Panel>
    );
  };

  if (!view) {
    return (
      <div className="boot">
        <div className="boot-card">
          <span className="brand-name">Pulso</span>
          <p>{status?.message ?? 'Buscando el servidor de datos…'}</p>
          <span className="boot-bar" />
        </div>
      </div>
    );
  }

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
      />

      <main className="grid">
        <Panel title={detail ? `Gráfico · ${detail.sym}` : 'Gráfico'} area="chart" mtab="chart" className="p-chart">
          <Chart detail={detail} alerts={alerts} themeKey={theme} />
        </Panel>
        <Panel title="Ficha" area="detail" mtab="chart" help="Datos clave, los 5 pilares, el estado del setup y un plan de riesgo 2:1 para la acción elegida.">
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
        <Panel title="Halts" area="halts" mtab="halts" count={activeHalts || undefined} help="Halts y reanudaciones del día. Las pausas por volatilidad (LULD) duran 5 minutos; al reanudar se compara contra el precio del halt.">
          <HaltsPanel halts={view.halts} now={now} selected={selected} onSelect={select} />
        </Panel>
        <Panel title="Top gappers" area="gappers" mtab="scan" count={sc?.gappers.length} help={scannerHelp('gappers', settings)}>
          {sc?.gappers.length ? <ScannerTable rows={sc.gappers} columns={SCANNER_COLUMNS.gappers} selected={selected} onSelect={select} /> : <Empty>Ningún gapper con estos criterios.</Empty>}
        </Panel>
        <Panel title="5 pilares" area="pillars" mtab="scan" count={sc?.pillars.length} help={scannerHelp('pillars', settings)}>
          {sc?.pillars.length ? <ScannerTable rows={sc.pillars} columns={SCANNER_COLUMNS.pillars} selected={selected} onSelect={select} /> : <Empty>Ninguna acción cumple {settings.pillarsMinScore} pilares todavía.</Empty>}
        </Panel>
        {scannerPanel('a', ['running', 'rvol'], 'scanA')}
        {scannerPanel('b', ['lowFloat', 'fades'], 'scanB')}
        <Panel title="Alertas" area="alerts" mtab="momo" help="Todas las alertas del motor. Filtrá por tipo o por cantidad de pilares.">
          <AlertFeed alerts={alerts} selected={selected} onSelect={select} />
        </Panel>
        <Panel title="Noticias" area="news" mtab="news" help="Titulares en tiempo real. Tocá un símbolo para ver su ficha.">
          <NewsPanel news={news} now={now} onSelect={select} known={(s) => knownSyms.has(s) || watch.includes(s)} />
        </Panel>
        <Panel title="Watchlist" area="watch" mtab="news" count={watch.length || undefined}>
          <WatchlistPanel rows={view.watch} watch={watch} selected={selected} onSelect={select} onRemove={(s) => updateWatch(watch.filter((x) => x !== s))} onAdd={(s) => !watch.includes(s) && updateWatch([...watch, s])} />
        </Panel>
        <Panel title="Rango del día" area="hod" mtab="halts" help="Dónde está el precio dentro del rango del día (mínimo a máximo) en los principales gappers. La marca vertical es el VWAP.">
          <HodBoard rows={view.hodBoard} selected={selected} onSelect={select} />
        </Panel>
      </main>

      <footer className="statusbar">
        <span className={`dot ${status?.connected ? 'on' : 'off'}`} />
        <span>{status?.message}</span>
        <span className="t-muted">
          {view.stats.tracked.toLocaleString('es-AR')} símbolos · {view.stats.active.toLocaleString('es-AR')} activos · {view.stats.eventsPerSec.toLocaleString('es-AR')} eventos/s
        </span>
        <span className="t-muted disclaimer">Herramienta informativa. No es asesoramiento financiero.</span>
      </footer>

      <MobileTabs tab={mobileTab} onTab={setMobileTab} haltCount={activeHalts} />

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
