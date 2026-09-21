import { useEffect, useState } from 'react';
import { useStore, FREE_PLAYS_PER_DAY, type Settings as S } from '../store/useStore';
import { useT } from '../i18n';
import { Toggle, Modal } from '../components/ui';
import { inputManager, type MidiDeviceInfo } from '../input/inputManager';
import { INSTRUMENT_META } from '../engine/instruments';
import type { InputMethod, Instrument } from '../engine/types';
import { click, getAudioContext, unlockAudio, setLatencyMode } from '../audio/engine';
import { Icon, INSTRUMENT_ICON } from '../components/Icon';

let deferredInstall: (Event & { prompt: () => Promise<void> }) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as Event & { prompt: () => Promise<void> };
  });
}

function Calibration({ onDone }: { onDone: (ms: number | null) => void }) {
  const t = useT();
  const [hits, setHits] = useState<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    const clicks: number[] = [];
    const run = async () => {
      await unlockAudio();
      const c = getAudioContext();
      const start = c.currentTime + 0.5;
      for (let i = 0; i < 10; i++) {
        click(start + i * 0.6, i % 4 === 0);
        clicks.push(start + i * 0.6);
      }
    };
    run();
    const unsub = inputManager.subscribe((e) => {
      if (cancelled || e.type !== 'off' && e.type !== 'on') return;
      if (e.type !== 'on') return;
      // Diferencia con el clic más cercano
      let best = Infinity;
      for (const ct of clicks) {
        const d = (e.time - ct) * 1000;
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
      if (Math.abs(best) < 250) setHits((h) => (h.length < 8 ? [...h, best] : h));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  const avg = hits.length ? Math.round(hits.reduce((a, b) => a + b, 0) / hits.length) : 0;
  return (
    <Modal onClose={() => onDone(null)}>
      <div className="col" style={{ textAlign: 'center', alignItems: 'center' }}>
        <h2>{t('calib.title')}</h2>
        <p className="muted">{t('calib.help')}</p>
        <div style={{ fontSize: 40, fontWeight: 900 }}>{t('calib.hits', { n: hits.length })}</div>
        <div className="row" style={{ gap: 6 }}>
          {[0, 1, 2, 3].map((r) => ['p12', 'p13', 'p14', 'p15'][r]).map((lane) => (
            <button key={lane} className="pad" style={{ width: 64, height: 64, ['--c' as string]: 'var(--accent-2)' }} onPointerDown={() => inputManager.touch(lane)} />
          ))}
        </div>
        {hits.length >= 8 && <p><b>{t('calib.result', { n: avg })}</b></p>}
        <div className="row">
          <button className="btn ghost" onClick={() => onDone(null)}>{t('calib.cancel')}</button>
          <button className="btn primary" disabled={hits.length < 8} onClick={() => onDone(Math.max(0, avg))}>{t('calib.apply')}</button>
        </div>
      </div>
    </Modal>
  );
}

export function Settings() {
  const t = useT();
  const s = useStore();
  const set = (p: Partial<S>) => s.setSettings(p);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>(inputManager.devices());
  const [calib, setCalib] = useState(false);
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => inputManager.onDevicesChange(setDevices), []);
  useEffect(() => {
    if (s.inputMethod === 'midi') inputManager.initMidi().then(setDevices);
  }, [s.inputMethod]);

  const Row = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
    <div className="setting-row">
      <div><label>{label}</label>{help && <div className="help">{help}</div>}</div>
      {children}
    </div>
  );

  return (
    <div className="fade-up col" style={{ gap: 16 }}>
      {calib && <Calibration onDone={(ms) => { setCalib(false); if (ms != null) set({ latencyMs: ms }); }} />}
      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)}>
          <div className="col" style={{ alignItems: 'center', textAlign: 'center' }}>
            <h2>{t('settings.reset')}</h2>
            <p className="muted">{t('settings.resetConfirm')}</p>
            <div className="row">
              <button className="btn ghost" onClick={() => setConfirmReset(false)}>{t('calib.cancel')}</button>
              <button className="btn danger" onClick={() => { s.resetProgress(); setConfirmReset(false); }}>{t('settings.reset')}</button>
            </div>
          </div>
        </Modal>
      )}
      <h1>{t('settings.title')}</h1>

      <div className="card">
        <h3>{t('settings.profile')}</h3>
        <Row label={t('settings.name')}><input type="text" value={s.name} onChange={(e) => useStore.setState({ name: e.target.value })} style={{ width: 160 }} /></Row>
        <Row label={t('settings.instrument')}>
          <div className="segmented">
            {(Object.keys(INSTRUMENT_META) as Instrument[]).map((i) => <button key={i} className={s.instrument === i ? 'active' : ''} onClick={() => s.setInstrument(i)} title={INSTRUMENT_META[i].label}><Icon name={INSTRUMENT_ICON[i]} size={16} /></button>)}
          </div>
        </Row>
        <Row label={t('settings.language')}>
          <div className="segmented">
            <button className={s.settings.lang === 'es' ? 'active' : ''} onClick={() => set({ lang: 'es' })}>Español</button>
            <button className={s.settings.lang === 'en' ? 'active' : ''} onClick={() => set({ lang: 'en' })}>English</button>
          </div>
        </Row>
        <Row label={t('settings.theme')}>
          <div className="segmented">
            {(['dark', 'light', 'system'] as const).map((th) => <button key={th} className={s.settings.theme === th ? 'active' : ''} onClick={() => set({ theme: th })}>{t(`settings.theme.${th}`)}</button>)}
          </div>
        </Row>
        <Row label={t('settings.goal')}>
          <div className="segmented">
            {([5, 10, 15, 20, 30] as const).map((m) => <button key={m} className={s.settings.dailyGoalMin === m ? 'active' : ''} onClick={() => set({ dailyGoalMin: m })}>{m}</button>)}
          </div>
        </Row>
      </div>

      <div className="card">
        <h3>{t('settings.input')}</h3>
        <Row label={t('settings.input')}>
          <div className="segmented">
            {(['midi', 'keyboard', 'touch'] as InputMethod[]).map((m) => <button key={m} className={s.inputMethod === m ? 'active' : ''} onClick={() => s.setInputMethod(m)}>{t(`settings.input.${m}`)}</button>)}
          </div>
        </Row>
        {s.inputMethod === 'midi' && (
          <Row label={t('settings.midiDevice')} help={!inputManager.midiSupported ? t('settings.midiUnsupported') : devices.length === 0 ? t('settings.midiNone') : undefined}>
            {inputManager.midiSupported ? (
              <div className="row">
                <select value={s.settings.midiDevice} onChange={(e) => { set({ midiDevice: e.target.value }); inputManager.setDevice(e.target.value); }}>
                  <option value="all">{t('settings.midiAll')}</option>
                  {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button className="btn sm" onClick={() => inputManager.initMidi().then(setDevices)}>{t('settings.midiConnect')}</button>
              </div>
            ) : null}
          </Row>
        )}
        <Row label={t('settings.latency')} help={t('settings.latencyHelp')}>
          <div className="row">
            <input type="range" min={0} max={300} step={5} value={s.settings.latencyMs} onChange={(e) => set({ latencyMs: Number(e.target.value) })} />
            <span style={{ minWidth: 50, textAlign: 'right' }}>{s.settings.latencyMs} ms</span>
            <button className="btn sm" onClick={() => setCalib(true)}>{t('settings.calibrate')}</button>
          </div>
        </Row>
        <Row label={t('settings.keyLabels')}><Toggle on={s.settings.showKeyLabels} onChange={(v) => set({ showKeyLabels: v })} /></Row>
        <Row label={t('settings.haptics')}><Toggle on={s.settings.haptics} onChange={(v) => set({ haptics: v })} /></Row>
      </div>

      <div className="card">
        <h3>{t('settings.audio')}</h3>
        <Row label={t('settings.audioMode')} help={t('settings.audioModeHelp')}>
          <div className="segmented">
            {(['interactive', 'playback'] as const).map((m) => <button key={m} className={s.settings.audioMode === m ? 'active' : ''} onClick={() => { set({ audioMode: m }); setLatencyMode(m); }}>{t(`settings.audioMode.${m}`)}</button>)}
          </div>
        </Row>
        <Row label={t('settings.volume')}><input type="range" min={0} max={1} step={0.05} value={s.settings.volume} onChange={(e) => set({ volume: Number(e.target.value) })} /></Row>
        <Row label={t('settings.backingVolume')}><input type="range" min={0} max={1} step={0.05} value={s.settings.backingVolume} onChange={(e) => set({ backingVolume: Number(e.target.value) })} /></Row>
      </div>

      <div className="card">
        <h3>{t('settings.lesson')}</h3>
        <Row label={t('settings.metronome')}><Toggle on={s.settings.metronome} onChange={(v) => set({ metronome: v })} /></Row>
        <Row label={t('settings.countIn')}><Toggle on={s.settings.countIn} onChange={(v) => set({ countIn: v })} /></Row>
        <Row label={t('settings.guide')}><Toggle on={s.settings.guide} onChange={(v) => set({ guide: v })} /></Row>
        <Row label={t('settings.backing')}><Toggle on={s.settings.backing} onChange={(v) => set({ backing: v })} /></Row>
        <Row label={t('settings.noteSpeed')}>
          <div className="segmented">
            {([1, 2, 3] as const).map((v) => <button key={v} className={s.settings.noteSpeed === v ? 'active' : ''} onClick={() => set({ noteSpeed: v })}>{t(v === 1 ? 'settings.slow' : v === 2 ? 'settings.normal' : 'settings.fast')}</button>)}
          </div>
        </Row>
        <Row label={t('settings.showHands')}><Toggle on={s.settings.showHands} onChange={(v) => set({ showHands: v })} /></Row>
        <Row label={t('settings.latinNames')}><Toggle on={s.settings.latinNames} onChange={(v) => set({ latinNames: v })} /></Row>
      </div>

      <div className="card">
        <h3>{t('settings.plan')}</h3>
        <p className="muted" style={{ margin: '8px 0 12px' }}>{s.premium ? t('settings.planPremium') : t('settings.planFree', { n: FREE_PLAYS_PER_DAY })}</p>
        {s.premium ? <button className="btn" onClick={() => s.setPremium(false)}>{t('settings.cancelPremium')}</button> : <button className="btn primary" onClick={() => s.setPremium(true)}><Icon name="sparkle" size={16} /> {t('settings.goPremium')}</button>}
      </div>

      <div className="card">
        <h3>{t('settings.data')}</h3>
        <Row label={t('settings.install')}>
          {installed ? <span className="chip">{t('settings.installed')}</span> : (
            <button className="btn sm" disabled={!deferredInstall} onClick={async () => { await deferredInstall?.prompt(); setInstalled(true); }}>{t('settings.install')}</button>
          )}
        </Row>
        <Row label={t('settings.reset')}><button className="btn danger sm" onClick={() => setConfirmReset(true)}>{t('settings.reset')}</button></Row>
        <p className="tiny" style={{ marginTop: 10 }}>{t('settings.about')}</p>
      </div>
    </div>
  );
}
