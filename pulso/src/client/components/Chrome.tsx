// Encabezado (reloj ET, sesión, modo, buscador, controles), ajustes y barra de pestañas del celular.
import { useEffect, useState, type ReactNode } from 'react';
import type { AlertType, ProviderStatus, Session, Settings } from '../../engine/types';
import { DEFAULT_SETTINGS } from '../../engine/types';
import { formatCountdown, formatEtClock, nextSessionChange, SESSION_LABEL } from '../../engine/time';
import { ALERT_META } from '../lib/alertMeta';
import { fmtMoney } from '../lib/format';
import { useNow } from '../lib/now';
import { NumberInput } from './NumberInput';
import { IconBolt, IconBook, IconChart, IconClose, IconGear, IconLayout, IconMoon, IconMute, IconNews, IconPulse, IconPause, IconScan, IconSearch, IconSound, IconSun, IconVoice } from './Icons';

export interface Prefs {
  sound: boolean;
  voice: boolean;
  voiceLang: 'es' | 'en';
  soundMinScore: number;
  soundTypes: AlertType[];
  momentumMinScore: number;
  theme: 'system' | 'dark' | 'light';
  /** Versión de los valores de audio (2: alertas con sonido y voz prendidas por defecto). */
  audioV?: number;
}

interface HeaderProps {
  session: Session;
  status: ProviderStatus | null;
  speed: number;
  onSpeed: (x: number) => void;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  onSettings: () => void;
  onSearch: (sym: string) => void;
  search: (prefix: string) => Promise<string[]>;
  effectiveTheme: 'dark' | 'light';
  /** Solo el simulador local acepta cambiar la velocidad. */
  canSpeed: boolean;
  /** Cuenta de práctica (equity y resultado del día). */
  account: { equity: number; dayPnl: number } | null;
  onJournal: () => void;
  /** Reacomodar ventanas (solo escritorio): estado y botón. */
  layoutEditing?: boolean;
  onLayout?: () => void;
  /** Día simulado (o "Mercado ahora"): etiqueta y botón para elegir otro día. */
  day?: { label: string; tone: 'live' | 'sim' | 'off'; title: string };
  onDay?: () => void;
  /** Con servidor de datos reales: elegir entre el mercado real y el simulador (misma cuenta). */
  sourceSwitch?: { sim: boolean; onSwitch: () => void };
}

export function Header({ session, status, speed, onSpeed, prefs, onPrefs, onSettings, onSearch, search, effectiveTheme, canSpeed, account, onJournal, layoutEditing, onLayout, day, onDay, sourceSwitch }: HeaderProps) {
  const [q, setQ] = useState('');
  const [suggest, setSuggest] = useState<string[]>([]);
  const next = useNow(1000);
  const nextChange = next ? nextSessionChange(next) : null;

  // Las sugerencias se piden 150 ms después de la última tecla (no en cada letra ni en cada dibujo).
  useEffect(() => {
    let alive = true;
    if (!q) {
      setSuggest([]);
      return;
    }
    const id = setTimeout(() => void search(q).then((r) => alive && setSuggest(r)), 150);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, search]);

  let badge = { cls: 'muted', text: 'Conectando…' };
  if (status) {
    if (status.mode === 'demo') badge = { cls: 'accent', text: 'DEMO · datos simulados' };
    // Mientras el proveedor carga (lista de acciones, cierres, volumen promedio) no es un corte: avisa que está en eso.
    else if (!status.connected && /^(Alpaca|Massive|Iniciando)/.test(status.message) && !/^Error|incorrect|límite/i.test(status.message)) badge = { cls: 'warn', text: 'CONECTANDO…' };
    else if (!status.connected) badge = { cls: 'down', text: 'SIN CONEXIÓN' };
    else if (status.badge) badge = { cls: 'up', text: status.badge };
    else if (!status.realtime) badge = { cls: 'warn', text: `DEMORADO · ${status.provider}` };
    else badge = { cls: 'up', text: `EN VIVO · ${status.provider}` };
  }

  return (
    <header className="top">
      <div className="brand">
        <span className="brand-mark">
          <IconPulse size={20} />
        </span>
        <span className="brand-name">Pulso</span>
        <span className={`mode-badge ${badge.cls}`} title={status?.message}>
          {badge.text}
        </span>
        {status && !status.connected && status.mode === 'live' && <span className="conn-msg">{status.message}</span>}
      </div>

      <div className="clock">
        <Clock />
        <span className="clock-tz">ET</span>
        <span className={`session s-${session}`}>{SESSION_LABEL[session]}</span>
        {nextChange && (
          <span className="countdown mono">
            {nextChange.label} {formatCountdown(nextChange.at - next)}
          </span>
        )}
        {sourceSwitch && (
          <div className="seg src-switch" role="group" aria-label="Mercado real o simulador">
            <button type="button" className={sourceSwitch.sim ? '' : 'is-active'} onClick={() => sourceSwitch.sim && sourceSwitch.onSwitch()} title="Los datos reales del servidor">
              Mercado real
            </button>
            <button type="button" className={sourceSwitch.sim ? 'is-active' : ''} onClick={() => !sourceSwitch.sim && sourceSwitch.onSwitch()} title="El mercado simulado: elegís día, hora y velocidad; la cuenta de práctica es la misma">
              Simulador
            </button>
          </div>
        )}
        {day && (
          <button type="button" className={`day-chip d-${day.tone}`} onClick={onDay} title={day.title}>
            {day.tone === 'live' && <span className="live-dot" aria-hidden="true" />}
            {day.label}
          </button>
        )}
      </div>

      {account && (
        <button className="account-chip" onClick={onJournal} title="Cuenta de práctica: abrir cuenta y métricas">
          <IconBook />
          <span className="mono">{fmtMoney(account.equity)}</span>
          <span className="account-chip-day">Hoy</span>
          <span className={`mono ${account.dayPnl > 0 ? 't-up' : account.dayPnl < 0 ? 't-down' : 't-muted'}`}>
            {account.dayPnl > 0 ? '+' : ''}
            {fmtMoney(account.dayPnl)}
          </span>
        </button>
      )}

      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const s = (suggest[0] ?? q).trim().toUpperCase();
          if (s) onSearch(s);
          setQ('');
        }}
      >
        <IconSearch />
        <input id="symbol-search" list="symbol-suggest" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="Buscar símbolo" aria-label="Buscar símbolo" autoComplete="off" maxLength={8} />
        <datalist id="symbol-suggest">
          {suggest.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>

      <div className="controls">
        {canSpeed && (
          <div className="seg speed" role="group" aria-label="Velocidad de la simulación">
            <button className={speed === 0 ? 'is-active' : ''} onClick={() => onSpeed(0)} aria-label="Pausar">
              <IconPause />
            </button>
            {[1, 2, 5, 10].map((x) => (
              <button key={x} className={speed === x ? 'is-active' : ''} onClick={() => onSpeed(x)}>
                {x}x
              </button>
            ))}
          </div>
        )}
        <button className={`icon-btn ${prefs.sound ? 'is-on' : ''}`} onClick={() => onPrefs({ sound: !prefs.sound })} aria-pressed={prefs.sound} title={prefs.sound ? 'Silenciar alertas' : 'Activar sonido de alertas'}>
          {prefs.sound ? <IconSound /> : <IconMute />}
        </button>
        <button className={`icon-btn ${prefs.voice ? 'is-on' : ''}`} onClick={() => onPrefs({ voice: !prefs.voice })} aria-pressed={prefs.voice} title={prefs.voice ? 'Apagar voz' : 'Leer las alertas en voz alta'}>
          <IconVoice />
        </button>
        {layoutEditing !== undefined && onLayout && (
          <button className={`icon-btn ${layoutEditing ? 'is-on' : ''}`} onClick={onLayout} aria-pressed={layoutEditing} title={layoutEditing ? 'Terminar de reacomodar las ventanas' : 'Reacomodar ventanas: moverlas y cambiarles el tamaño'}>
            <IconLayout />
          </button>
        )}
        <button className="icon-btn" onClick={() => onPrefs({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' })} title="Cambiar tema claro / oscuro">
          {effectiveTheme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <button className="icon-btn" onClick={onSettings} title="Ajustes de los escáneres y alertas">
          <IconGear />
        </button>
      </div>
    </header>
  );
}

/** La hora de Nueva York, con segundos: es lo único que se vuelve a dibujar cuatro veces por segundo. */
function Clock() {
  const now = useNow();
  return <span className="clock-time mono">{now ? formatEtClock(now) : '--:--:--'}</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface SettingsProps {
  settings: Settings;
  prefs: Prefs;
  onSave: (s: Settings, p: Prefs) => void;
  onClose: () => void;
  /** Abre los ajustes de la cuenta de práctica (cuenta, órdenes y atajos). */
  onPractice?: () => void;
}

export function SettingsModal({ settings, prefs, onSave, onClose, onPractice }: SettingsProps) {
  const [s, setS] = useState<Settings>(settings);
  const [p, setP] = useState<Prefs>(prefs);
  // Campos numéricos: lo que escribís queda tal cual (vale la coma decimal) y se guarda cuando es un número.
  const num = (k: keyof Settings, scale = 1) => ({
    value: Number((s[k] / scale).toFixed(4)),
    onCommit: (v: number) => setS((cur) => ({ ...cur, [k]: v * scale })),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="settings-title">Ajustes de escáneres y alertas</h2>
          {onPractice && (
            <button type="button" className="btn ghost" onClick={onPractice}>
              Cuenta, órdenes y atajos de práctica…
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconClose />
          </button>
        </header>
        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(s, p);
          }}
        >
          <fieldset>
            <legend>Los 5 pilares</legend>
            <p className="legend-hint">Criterios de selección de small caps para momentum: precio, suba del día, volumen relativo, noticia y float.</p>
            <div className="grid-fields">
              <Field label="Precio mínimo (US$)">
                <NumberInput id="set-price-min" {...num('priceMin')} min={0} />
              </Field>
              <Field label="Precio máximo (US$)">
                <NumberInput id="set-price-max" {...num('priceMax')} min={1} />
              </Field>
              <Field label="Suba mínima del día (%)">
                <NumberInput id="set-min-change" {...num('minChangePct')} min={0} />
              </Field>
              <Field label="Volumen relativo mínimo (x)" hint="Ajustado por horario">
                <NumberInput id="set-min-rvol" {...num('minRvol')} min={0} />
              </Field>
              <Field label="Float ideal máximo (millones)">
                <NumberInput id="set-max-float" {...num('maxFloat', 1e6)} min={0} />
              </Field>
              <Field label="Float aceptable (millones)" hint="Lista Low float">
                <NumberInput id="set-max-float-soft" {...num('maxFloatSoft', 1e6)} min={0} />
              </Field>
              <Field label="Noticia: ventana (horas)">
                <NumberInput id="set-news-window" {...num('newsWindowHours')} min={1} />
              </Field>
              <Field label="Lista 5 pilares: mínimo">
                <NumberInput id="set-pillars-min" {...num('pillarsMinScore')} min={1} max={5} />
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Escáneres</legend>
            <div className="grid-fields">
              <Field label="Volumen mínimo del día">
                <NumberInput id="set-min-volume" {...num('minVolume')} min={0} />
              </Field>
              <Field label="Gappers: suba mínima (%)">
                <NumberInput id="set-gapper-min" {...num('gapperMinPct')} min={0} />
              </Field>
              <Field label="Subiendo ahora: % en 5 min">
                <NumberInput id="set-run-min" {...num('runMinPct5m')} min={0} />
              </Field>
              <Field label="Alertas de máximo: suba mín. (%)">
                <NumberInput id="set-hod-min" {...num('hodMinChangePct')} min={0} />
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Sonido y voz</legend>
            <div className="grid-fields">
              <Field label="Pilares mínimos para sonar">
                <select id="set-sound-min" value={p.soundMinScore} onChange={(e) => setP({ ...p, soundMinScore: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Panel Momentum: pilares mínimos">
                <select id="set-momo-min" value={p.momentumMinScore} onChange={(e) => setP({ ...p, momentumMinScore: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Idioma de la voz">
                <select id="set-voice-lang" value={p.voiceLang} onChange={(e) => setP({ ...p, voiceLang: e.target.value as 'es' | 'en' })}>
                  <option value="es">Español</option>
                  <option value="en">Inglés</option>
                </select>
              </Field>
            </div>
            <div className="type-grid" role="group" aria-label="Alertas que suenan">
              {(Object.keys(ALERT_META) as AlertType[]).map((t) => (
                <label key={t} className="type-check">
                  <input
                    id={`set-sound-${t}`}
                    type="checkbox"
                    checked={p.soundTypes.includes(t)}
                    onChange={(e) => setP({ ...p, soundTypes: e.target.checked ? [...p.soundTypes, t] : p.soundTypes.filter((x) => x !== t) })}
                  />
                  {ALERT_META[t].label}
                </label>
              ))}
            </div>
          </fieldset>
          <footer className="modal-foot">
            <button type="button" className="btn ghost" onClick={() => setS(DEFAULT_SETTINGS)}>
              Restablecer criterios
            </button>
            <button type="submit" className="btn primary">
              Guardar
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export type MobileTab = 'scan' | 'momo' | 'chart' | 'news' | 'diario';

export function MobileTabs({ tab, onTab, haltCount }: { tab: MobileTab; onTab: (t: MobileTab) => void; haltCount: number }) {
  const items: Array<{ id: MobileTab; label: string; icon: ReactNode }> = [
    { id: 'scan', label: 'Escáner', icon: <IconScan /> },
    { id: 'momo', label: 'Alertas', icon: <IconBolt /> },
    { id: 'chart', label: 'Operar', icon: <IconChart /> },
    { id: 'news', label: 'Cotización', icon: <IconNews /> },
    { id: 'diario', label: 'Métricas', icon: <IconBook size={20} /> },
  ];
  return (
    <nav className="mobile-tabs" aria-label="Secciones">
      {items.map((i) => (
        <button key={i.id} className={tab === i.id ? 'is-active' : ''} onClick={() => onTab(i.id)} aria-current={tab === i.id ? 'page' : undefined}>
          {i.icon}
          <span>{i.label}</span>
          {i.id === 'momo' && haltCount > 0 && <em className="dot-count">{haltCount}</em>}
        </button>
      ))}
    </nav>
  );
}
