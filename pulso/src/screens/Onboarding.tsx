import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { InputMethod, Instrument } from '../engine/types';
import { INSTRUMENT_META } from '../engine/instruments';
import { useT } from '../i18n';
import { inputManager } from '../input/inputManager';
import { unlockAudio } from '../audio/engine';

export function Onboarding() {
  const t = useT();
  const complete = useStore((s) => s.completeOnboarding);
  const setSettings = useStore((s) => s.setSettings);
  const lang = useStore((s) => s.settings.lang);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState<Instrument>('drums');
  const [input, setInput] = useState<InputMethod>(() => (window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard'));
  const [exp, setExp] = useState<'new' | 'some' | 'pro'>('new');
  const [goal, setGoal] = useState<5 | 10 | 15 | 20 | 30>(10);
  const total = 5;

  const finish = async () => {
    await unlockAudio();
    if (input === 'midi') inputManager.initMidi();
    setSettings({ dailyGoalMin: goal });
    complete({ name: name.trim() || (lang === 'es' ? 'Músico' : 'Musician'), instrument, inputMethod: input, experience: exp });
  };

  return (
    <div className="onb">
      <div className="onb-card card fade-up" key={step}>
        <div className="row between" style={{ marginBottom: 18 }}>
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-logo">〰️</div>Pulso
          </div>
          <div className="segmented">
            <button className={lang === 'es' ? 'active' : ''} onClick={() => setSettings({ lang: 'es' })}>ES</button>
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setSettings({ lang: 'en' })}>EN</button>
          </div>
        </div>
        {step === 0 && (
          <div className="col">
            <h1>{t('onb.welcome')}</h1>
            <p className="muted">{t('onb.subtitle')}</p>
            <label className="tiny" style={{ marginTop: 10 }}>{t('onb.name')}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="…" autoFocus maxLength={24} />
          </div>
        )}
        {step === 1 && (
          <div className="col">
            <h2>{t('onb.instrument')}</h2>
            <div className="choice-grid">
              {(Object.keys(INSTRUMENT_META) as Instrument[]).map((i) => (
                <button key={i} className={`choice ${instrument === i ? 'active' : ''}`} onClick={() => setInstrument(i)}>
                  <span className="big">{INSTRUMENT_META[i].emoji}</span>
                  <span className="t">{INSTRUMENT_META[i].label}</span>
                  <span className="d">{INSTRUMENT_META[i].description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="col">
            <h2>{t('onb.input')}</h2>
            <div className="choice-grid" style={{ gridTemplateColumns: '1fr' }}>
              {(['midi', 'keyboard', 'touch'] as InputMethod[]).map((m) => (
                <button key={m} className={`choice ${input === m ? 'active' : ''}`} onClick={() => setInput(m)}>
                  <span className="t">{m === 'midi' ? '🎛️ ' : m === 'keyboard' ? '⌨️ ' : '👆 '}{t(`onb.input.${m}`)}</span>
                  <span className="d">{t(`onb.input.${m}Help`)}</span>
                </button>
              ))}
            </div>
            {input === 'midi' && !inputManager.midiSupported && <p className="tiny" style={{ color: 'var(--orange)' }}>{t('settings.midiUnsupported')}</p>}
          </div>
        )}
        {step === 3 && (
          <div className="col">
            <h2>{t('onb.experience')}</h2>
            <div className="choice-grid">
              {(['new', 'some', 'pro'] as const).map((e) => (
                <button key={e} className={`choice ${exp === e ? 'active' : ''}`} onClick={() => setExp(e)}>
                  <span className="big">{e === 'new' ? '🌱' : e === 'some' ? '🎵' : '🔥'}</span>
                  <span className="t">{t(`onb.exp.${e}`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="col">
            <h2>{t('onb.goal')}</h2>
            <p className="muted">{t('onb.goalHelp')}</p>
            <div className="choice-grid">
              {([[5, 'casual'], [10, 'regular'], [20, 'serious'], [30, 'intense']] as const).map(([m, k]) => (
                <button key={m} className={`choice ${goal === m ? 'active' : ''}`} onClick={() => setGoal(m)}>
                  <span className="t">{m} {t('common.min')}</span>
                  <span className="d">{t(`onb.${k}`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row between" style={{ marginTop: 24 }}>
          <div className="dots">{Array.from({ length: total }, (_, i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>
          <div className="row">
            {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>{t('onb.back')}</button>}
            {step < total - 1 ? (
              <button className="btn primary" onClick={() => setStep(step + 1)}>{t('onb.next')}</button>
            ) : (
              <button className="btn primary" onClick={finish}>{t('onb.finish')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
