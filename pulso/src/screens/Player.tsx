import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLesson, getCourse, LESSONS } from '../content';
import { useStore } from '../store/useStore';
import { navigate } from '../router';
import { useT } from '../i18n';
import { LessonPlayer, type PlayerOptions } from '../engine/player';
import type { HitJudgement, HitResult, Lesson, LessonResult, StepScore } from '../engine/types';
import { Highway, computeKeyLayout, stepKeyRange, type KeyLayout } from '../components/Highway';
import { DrumKit, PadGrid, Piano } from '../components/Instruments';
import { Results } from '../components/Results';
import { inputManager } from '../input/inputManager';
import { playLane, releaseLane, setBackingVolume, setMasterVolume, unlockAudio } from '../audio/engine';
import { starsFor, xpFor, JUDGEMENT_COLORS } from '../engine/scoring';
import { INSTRUMENT_META } from '../engine/instruments';

interface Ui {
  status: LessonPlayer['state']['status'];
  streak: number;
  lastJudgement: { j: HitJudgement; at: number } | null;
  bpm: number;
  countInBeat: number;
  score: number;
  cues: string;
  loopPass: number;
}

function nextLesson(l: Lesson): Lesson | null {
  if (l.courseId) {
    const c = getCourse(l.courseId);
    if (c) {
      const i = c.lessonIds.indexOf(l.id);
      const n = c.lessonIds[i + 1];
      if (n) return getLesson(n) ?? null;
    }
  }
  const same = LESSONS.filter((x) => x.instrument === l.instrument && x.kind === l.kind && x.id !== l.id).sort((a, b) => a.grade - b.grade);
  return same.find((x) => x.grade >= l.grade) ?? same[0] ?? null;
}

export function Player({ id, practice: initialPractice }: { id: string; practice?: boolean }) {
  const t = useT();
  const lesson = getLesson(id);
  const store = useStore();
  const settings = store.settings;
  const [stepIndex, setStepIndex] = useState(0);
  const [practice, setPractice] = useState(!!initialPractice);
  const [loop, setLoop] = useState<[number, number] | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(!!initialPractice);
  const [loopPick, setLoopPick] = useState<number | null>(null);
  const [waitMode, setWaitMode] = useState(false);
  const [autoBpm, setAutoBpm] = useState(false);
  const [bpm, setBpm] = useState(lesson ? (initialPractice ? Math.round(lesson.bpm * 0.7) : lesson.bpm) : 100);
  const [metronome, setMetronome] = useState(settings.metronome);
  const [guide, setGuide] = useState(settings.guide);
  const [backing, setBacking] = useState(settings.backing);
  const [gen, setGen] = useState(0);
  const [ui, setUi] = useState<Ui>({ status: 'idle', streak: 0, lastJudgement: null, bpm, countInBeat: 0, score: 100, cues: '', loopPass: 0 });
  const [stepDone, setStepDone] = useState<StepScore | null>(null);
  const [final, setFinal] = useState<{ result: LessonResult; perf: StepScore; hits: HitResult[]; flags: { newTrophies: string[]; leveledUp: boolean; goalJustHit: boolean }; isNewBest: boolean; isRecord: boolean } | null>(null);
  const instRef = useRef<HTMLDivElement>(null);
  const [instW, setInstW] = useState(0);
  const elapsedRef = useRef(0);
  const stepScoresRef = useRef<StepScore[]>([]);
  const prevBestRef = useRef(store.progress[id]?.bestScore ?? 0);
  const prevStarsRef = useRef(store.progress[id]?.bestStars ?? 0);

  const step = lesson?.steps[stepIndex];
  const isPerf = !!lesson && stepIndex === lesson.steps.length - 1;

  // Layout de teclado (compartido por pista y piano)
  const keyLayout: KeyLayout | undefined = useMemo(() => {
    if (!lesson || lesson.instrument !== 'keys' || !step || instW === 0) return undefined;
    const [lo, hi] = stepKeyRange(step);
    return computeKeyLayout(lo, hi, instW);
  }, [lesson, step, instW]);

  useEffect(() => {
    const el = instRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInstW(el.clientWidth));
    ro.observe(el);
    setInstW(el.clientWidth);
    return () => ro.disconnect();
  }, [lesson]);

  // Reproductor por paso
  const player = useMemo(() => {
    if (!lesson || !step) return null;
    const opts: PlayerOptions = {
      instrument: lesson.instrument,
      step,
      bpm,
      timeSig: lesson.timeSig,
      metronome,
      countIn: settings.countIn,
      guide,
      backing,
      loop,
      loopEnabled: practice && loopEnabled,
      waitMode: practice && waitMode,
      autoBpm: practice && autoBpm,
      targetBpm: lesson.bpm,
      latencyMs: settings.latencyMs,
      chords: lesson.chords,
    };
    return new LessonPlayer(opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, step, gen]);

  useEffect(() => {
    if (!player) return;
    player.setOptions({ bpm, metronome, guide, backing, loop, loopEnabled: practice && loopEnabled, waitMode: practice && waitMode, autoBpm: practice && autoBpm, latencyMs: settings.latencyMs });
  }, [player, bpm, metronome, guide, backing, loop, loopEnabled, waitMode, autoBpm, practice, settings.latencyMs]);

  useEffect(() => {
    if (!player || !step) return;
    (window as unknown as { __pulso?: unknown }).__pulso = { player, touch: (lane: string) => inputManager.touch(lane) };
    let lastCues = '';
    setStepDone(null);
    setUi({ status: player.state.status, streak: 0, lastJudgement: null, bpm: player.state.bpm, countInBeat: 0, score: 100, cues: '', loopPass: 0 });
    const unsub = player.subscribe((s) => {
      // cues: carriles con notas en los próximos 0.5 tiempos
      const cues: string[] = [];
      for (let i = 0; i < step.notes.length; i++) {
        const n = step.notes[i];
        if (s.noteStates[i] === null && n.beat >= s.beat - 0.05 && n.beat <= s.beat + 0.5) cues.push(n.lane);
      }
      const cueKey = cues.join(',');
      const score = s.status === 'idle' ? 100 : player.currentScore().score;
      setUi((u) => {
        if (u.status === s.status && u.streak === s.streak && u.lastJudgement === s.lastJudgement && u.bpm === s.bpm && u.countInBeat === s.countInBeat && u.score === score && lastCues === cueKey && u.loopPass === s.loopPass) return u;
        lastCues = cueKey;
        return { status: s.status, streak: s.streak, lastJudgement: s.lastJudgement, bpm: s.bpm, countInBeat: s.countInBeat, score, cues: cueKey, loopPass: s.loopPass };
      });
      if (s.status === 'finished') setStepDone(player.currentScore());
    });
    return () => {
      unsub();
      player.destroy();
    };
  }, [player, step]);

  // Entrada → sonido del instrumento
  useEffect(() => {
    if (!lesson) return;
    inputManager.setInstrument(lesson.instrument);
    inputManager.setKeyboardEnabled(true);
    inputManager.setDevice(settings.midiDevice);
    if (store.inputMethod === 'midi') inputManager.initMidi();
    setMasterVolume(settings.volume);
    setBackingVolume(settings.backingVolume);
    const unsub = inputManager.subscribe((e) => {
      if (e.type === 'on') playLane(lesson.instrument, e.lane, undefined, e.velocity || 0.9);
      else releaseLane(lesson.instrument, e.lane);
    });
    return unsub;
  }, [lesson, settings.midiDevice, settings.volume, settings.backingVolume, store.inputMethod]);

  // Tiempo practicado
  useEffect(() => {
    const active = ui.status === 'playing' || ui.status === 'countin' || ui.status === 'waiting';
    if (!active) return;
    const iv = window.setInterval(() => (elapsedRef.current += 1), 1000);
    return () => window.clearInterval(iv);
  }, [ui.status]);
  useEffect(() => {
    return () => {
      if (elapsedRef.current > 0) useStore.getState().addPractice(elapsedRef.current);
      elapsedRef.current = 0;
    };
  }, []);

  // Teclas rápidas
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Escape') exit();
      if (e.code === 'Enter') {
        if (ui.status === 'idle') start();
        else if (ui.status === 'paused') player?.resume();
        else if (ui.status === 'finished') stepDone && (isPerf ? finishLesson() : goNext());
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const start = useCallback(async () => {
    await unlockAudio();
    setStepDone(null);
    player?.start();
  }, [player]);

  const restart = () => {
    setStepDone(null);
    setGen((g) => g + 1);
  };
  const goNext = () => {
    if (!lesson || !stepDone) return;
    stepScoresRef.current[stepIndex] = stepDone;
    setStepDone(null);
    setStepIndex((i) => Math.min(lesson.steps.length - 1, i + 1));
  };
  const exit = () => {
    navigate({ name: 'lesson', id }, false);
  };

  const finishLesson = () => {
    if (!lesson || !player || !stepDone) return;
    const perf = stepDone;
    const steps = [...stepScoresRef.current.slice(0, lesson.steps.length - 1), perf];
    const score = perf.score;
    const stars = starsFor(score);
    const notes = lesson.steps[lesson.steps.length - 1].notes.length;
    const xp = xpFor(score, lesson.grade, notes);
    const result: LessonResult = { lessonId: lesson.id, score, stars, steps, bpm: ui.bpm, durationSec: elapsedRef.current, date: new Date().toISOString(), xp };
    elapsedRef.current = 0;
    const flags = store.recordResult(result);
    const isNewBest = score > prevBestRef.current;
    const isRecord = stars >= 2 && prevStarsRef.current < 2;
    prevBestRef.current = Math.max(prevBestRef.current, score);
    prevStarsRef.current = Math.max(prevStarsRef.current, stars) as 0 | 1 | 2 | 3;
    setFinal({ result, perf, hits: player.state.hits, flags, isNewBest, isRecord });
  };

  if (!lesson || !step || !player) return <div className="card">404</div>;

  if (final) {
    const nl = nextLesson(lesson);
    return (
      <Results
        lesson={lesson}
        result={final.result}
        perf={final.perf}
        hits={final.hits}
        isNewBest={final.isNewBest}
        isRecord={final.isRecord}
        newTrophies={final.flags.newTrophies}
        leveledUp={final.flags.leveledUp}
        goalJustHit={final.flags.goalJustHit}
        next={nl}
        onRetry={() => { setFinal(null); setStepIndex(0); stepScoresRef.current = []; setGen((g) => g + 1); }}
        onPractice={() => { setFinal(null); setPractice(true); setLoopEnabled(true); setStepIndex(0); setGen((g) => g + 1); }}
        onNext={() => nl && navigate({ name: 'lesson', id: nl.id }, true)}
        onHome={() => navigate({ name: 'home' }, true)}
      />
    );
  }

  const meta = INSTRUMENT_META[lesson.instrument];
  const cues = new Set(ui.cues ? ui.cues.split(',') : []);
  const judgeText = ui.lastJudgement && Date.now() / 1000 - 0 ? ui.lastJudgement : null;
  const bars = step.bars;
  const bpmPct = Math.round((ui.bpm / lesson.bpm) * 100);

  const pickBar = (b: number) => {
    if (loopPick == null) {
      setLoopPick(b);
      setLoop([b, b + 1]);
    } else {
      const a = Math.min(loopPick, b);
      const z = Math.max(loopPick, b) + 1;
      setLoop([a, z]);
      setLoopPick(null);
    }
    setLoopEnabled(true);
    if (ui.status !== 'idle') restart();
  };

  return (
    <div className="player">
      <div className="player-top">
        <button className="iconbtn" onClick={exit} aria-label={t('player.exit')}>✕</button>
        <div className="titlebox" style={{ flex: 1, minWidth: 0 }}>
          <div className="title">{lesson.title} <span className="tiny">· {meta.emoji} {lesson.artist}</span></div>
          <div className="step-row">
            <div className="step-bar">{lesson.steps.map((s, i) => <i key={s.id} className={i < stepIndex ? 'done' : i === stepIndex ? 'cur' : ''} />)}</div>
            <span className="sub">{t('player.step', { n: stepIndex + 1, total: lesson.steps.length })} · {step.title}</span>
          </div>
        </div>
        <div className="tools">
          <button className={`iconbtn ${metronome ? 'active' : ''}`} title={t('player.metronome')} onClick={() => setMetronome(!metronome)}>🎚️</button>
          <button className={`iconbtn ${guide ? 'active' : ''}`} title={t('player.guide')} onClick={() => setGuide(!guide)}>🎧</button>
          <button className={`iconbtn ${backing ? 'active' : ''}`} title={t('player.backing')} onClick={() => setBacking(!backing)}>🎼</button>
          <button className={`iconbtn ${practice ? 'active' : ''}`} title={t('player.practice')} onClick={() => { setPractice(!practice); if (!practice) setLoopEnabled(true); restart(); }}>🔁</button>
        </div>
      </div>
      <div className="landscape-hint">{t('landscape.hint')}</div>

      <div className="player-highway">
        <Highway instrument={lesson.instrument} step={step} player={player} noteSpeed={settings.noteSpeed} latinNames={settings.latinNames} showHands={settings.showHands} keyLayout={keyLayout} loop={loop} loopEnabled={practice && loopEnabled} />
        <div className="hud-score">{ui.score}%</div>
        {ui.streak >= 3 && <div className="hud-streak">🔥 {ui.streak}</div>}
        <div className="player-hud">
          {judgeText && ui.status !== 'idle' && ui.status !== 'finished' && (
            <div key={judgeText.at} className="hud-judge" style={{ color: JUDGEMENT_COLORS[judgeText.j] }}>{t(`player.${judgeText.j}`)}</div>
          )}
        </div>
        {ui.status === 'countin' && <div className="countin">{Math.max(1, lesson.timeSig[0] - Math.max(0, ui.countInBeat) + (ui.countInBeat >= 0 ? 0 : 0))}</div>}
        {ui.status === 'waiting' && <div className="player-hud" style={{ top: 'auto', bottom: 12 }}><span className="chip active">{t('player.waiting')}</span></div>}
        {ui.status === 'idle' && (
          <div className="overlay" onClick={start}>
            <div className="panel">
              {step.tip && <p className="muted" style={{ maxWidth: 360 }}>{step.tip}</p>}
              <button className="btn primary" style={{ fontSize: 18, padding: '16px 32px' }}>▶ {t('player.play')}</button>
              <span className="tiny">{t('player.tapToStart')} · {store.inputMethod === 'keyboard' ? '⌨️' : store.inputMethod === 'midi' ? '🎛️' : '👆'}</span>
            </div>
          </div>
        )}
        {ui.status === 'paused' && (
          <div className="overlay">
            <div className="panel">
              <button className="btn primary" onClick={() => player.resume()}>▶ {t('player.resume')}</button>
              <button className="btn" onClick={restart}>{t('player.restart')}</button>
            </div>
          </div>
        )}
        {ui.status === 'finished' && stepDone && (
          <div className="overlay">
            <div className="panel card fade-up">
              <div className="tiny">{step.title}</div>
              <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1 }}>{stepDone.score}</div>
              <div className="row" style={{ gap: 10, fontSize: 13 }}>
                <span style={{ color: JUDGEMENT_COLORS.perfect }}>● {stepDone.perfect}</span>
                <span style={{ color: JUDGEMENT_COLORS.early }}>● {stepDone.early}</span>
                <span style={{ color: JUDGEMENT_COLORS.late }}>● {stepDone.late}</span>
                <span style={{ color: JUDGEMENT_COLORS.miss }}>● {stepDone.miss}</span>
              </div>
              <div className="row">
                <button className="btn" onClick={restart}>🔄 {t('player.retry')}</button>
                {isPerf ? (
                  practice ? <button className="btn primary" onClick={() => { setPractice(false); setBpm(lesson.bpm); setStepIndex(lesson.steps.length - 1); restart(); }}>{t('player.perform')} →</button>
                  : <button className="btn primary" onClick={finishLesson}>{t('player.finish')} →</button>
                ) : (
                  <button className="btn primary" onClick={goNext}>{t('player.next')} →</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {practice && (
        <div className="practice-bar">
          <div className="bpm">
            <button onClick={() => setBpm((b) => Math.max(30, b - 5))}>−</button>
            <b>{ui.status === 'idle' ? bpm : ui.bpm} BPM</b>
            <button onClick={() => setBpm((b) => Math.min(240, b + 5))}>+</button>
            <span className="tiny">{bpmPct}%</span>
          </div>
          <button className={`pill ${loopEnabled ? 'on' : ''}`} onClick={() => setLoopEnabled(!loopEnabled)}>🔁 {t('player.loop')}{loop && loopEnabled ? ` ${loop[0] + 1}–${loop[1]}` : ''}</button>
          <div className="loop-bars">
            {Array.from({ length: bars }, (_, b) => (
              <button key={b} className={loopEnabled && loop && b >= loop[0] && b < loop[1] ? 'in' : ''} onClick={() => pickBar(b)}>{b + 1}</button>
            ))}
            {loop && <button onClick={() => { setLoop(null); setLoopPick(null); }}>✕</button>}
          </div>
          <button className={`pill ${waitMode ? 'on' : ''}`} onClick={() => setWaitMode(!waitMode)}>⏸ {t('player.wait')}</button>
          <button className={`pill gold ${autoBpm ? 'on' : ''}`} onClick={() => setAutoBpm(!autoBpm)}>⚡ {t('player.autoBpm')}</button>
          {(ui.status === 'playing' || ui.status === 'waiting' || ui.status === 'countin') && <button className="pill" onClick={() => player.pause()}>⏸ {t('player.pause')}</button>}
          {ui.loopPass > 0 && <span className="tiny">×{ui.loopPass}</span>}
        </div>
      )}
      {!practice && (ui.status === 'playing' || ui.status === 'waiting' || ui.status === 'countin') && (
        <div className="player-controls">
          <button className="pill" onClick={() => player.pause()}>⏸ {t('player.pause')}</button>
          <button className="pill" onClick={restart}>🔄 {t('player.restart')}</button>
        </div>
      )}

      <div className="player-instrument" ref={instRef}>
        {lesson.instrument === 'drums' && <DrumKit cues={cues} />}
        {lesson.instrument === 'pads' && <PadGrid cues={cues} />}
        {lesson.instrument === 'keys' && keyLayout && <Piano layout={keyLayout} cues={cues} />}
        {lesson.instrument === 'keys' && store.inputMethod === 'keyboard' && <div className="tiny" style={{ textAlign: 'center', marginTop: 4 }}>{t('player.octave')}: Z / X</div>}
      </div>
    </div>
  );
}
