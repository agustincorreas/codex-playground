// Encabezado (reloj ET, sesión, modo, buscador, controles), ajustes y barra de pestañas del celular.
import { useEffect, useState, type ReactNode } from 'react';
import type { AlertType, ProviderStatus, Session, Settings } from '../../engine/types';
import { DEFAULT_SETTINGS } from '../../engine/types';
import { formatCountdown, formatEtClock, nextSessionChange, SESSION_LABEL } from '../../engine/time';
import { ALERT_META } from '../lib/alertMeta';
import { fmtMoney } from '../../trading/broker';
import { IconBolt, IconBook, IconChart, IconClose, IconGear, IconMoon, IconMute, IconNews, IconPulse, IconPause, IconScan, IconSearch, IconSound, IconSun, IconVoice } from './Icons';

export interface Prefs {
  sound: boolean;
  voice: boolean;
  voiceLang: 'es' | 'en';
  soundMinScore: number;
  soundTypes: AlertType[];
  momentumMinScore: number;
  theme: 'system' | 'dark' | 'light';
}

interface HeaderProps {
  now: number;
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
}

export function Header({ now, session, status, speed, onSpeed, prefs, onPrefs, onSettings, onSearch, search, effectiveTheme, canSpeed, account, onJournal }: HeaderProps) {
  const [q, setQ] = useState('');
  const [suggest, setSuggest] = useState<string[]>([]);
  const next = now ? nextSessionChange(now) : null;

  useEffect(() => {
    let alive = true;
    if (!q) {
      setSuggest([]);
      return;
    }
    void search(q).then((r) => alive && setSuggest(r));
    return () => {
      alive = false;
    };
  }, [q, search]);

  let badge = { cls: 'muted', text: 'Conectando…' };
  if (status) {
    if (status.mode === 'demo') badge = { cls: 'accent', text: 'DEMO · datos simulados' };
    else if (!status.connected) badge = { cls: 'down', text: 'SIN CONEXIÓN' };
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
      </div>

      <div className="clock">
        <span className="clock-time mono">{now ? formatEtClock(now) : '--:--:--'}</span>
        <span className="clock-tz">ET</span>
        <span className={`session s-${session}`}>{SESSION_LABEL[session]}</span>
        {next && (
          <span className="countdown mono">
            {next.label} {formatCountdown(next.at - now)}
          </span>
        )}
      </div>

      {account && (
        <button className="account-chip" onClick={onJournal} title="Cuenta de práctica: abrir cuenta y métricas">
          <IconBook />
          <span className="mono">{fmtMoney(account.equity)}</span>
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
  const num = (k: keyof Settings, scale = 1) => ({
    type: 'number',
    inputMode: 'decimal' as const,
    value: String(Number((s[k] / scale).toFixed(4))),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) setS({ ...s, [k]: v * scale });
    },
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
                <input id="set-price-min" {...num('priceMin')} step="0.5" min={0} />
              </Field>
              <Field label="Precio máximo (US$)">
                <input id="set-price-max" {...num('priceMax')} step="1" min={1} />
              </Field>
              <Field label="Suba mínima del día (%)">
                <input id="set-min-change" {...num('minChangePct')} step="1" min={0} />
              </Field>
              <Field label="Volumen relativo mínimo (x)" hint="Ajustado por horario">
                <input id="set-min-rvol" {...num('minRvol')} step="0.5" min={0} />
              </Field>
              <Field label="Float ideal máximo (millones)">
                <input id="set-max-float" {...num('maxFloat', 1e6)} step="1" min={0} />
              </Field>
              <Field label="Float aceptable (millones)" hint="Lista Low float">
                <input id="set-max-float-soft" {...num('maxFloatSoft', 1e6)} step="1" min={0} />
              </Field>
              <Field label="Noticia: ventana (horas)">
                <input id="set-news-window" {...num('newsWindowHours')} step="1" min={1} />
              </Field>
              <Field label="Lista 5 pilares: mínimo">
                <input id="set-pillars-min" {...num('pillarsMinScore')} step="1" min={1} max={5} />
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Escáneres</legend>
            <div className="grid-fields">
              <Field label="Volumen mínimo del día">
                <input id="set-min-volume" {...num('minVolume')} step="10000" min={0} />
              </Field>
              <Field label="Gappers: suba mínima (%)">
                <input id="set-gapper-min" {...num('gapperMinPct')} step="1" min={0} />
              </Field>
              <Field label="Subiendo ahora: % en 5 min">
                <input id="set-run-min" {...num('runMinPct5m')} step="0.5" min={0} />
              </Field>
              <Field label="Alertas de máximo: suba mín. (%)">
                <input id="set-hod-min" {...num('hodMinChangePct')} step="1" min={0} />
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
