// Transporte de una lección: programa el audio, evalúa los golpes del usuario,
// maneja loop / Wait Mode / Auto-BPM / cuenta de entrada.
import type { HitJudgement, HitResult, Instrument, LessonNote, LessonStep, StepScore } from './types';
import { computeStepScore, judge, TIMING } from './scoring';
import { backingChord, click, getAudioContext, playLane } from '../audio/engine';
import { inputManager, type InputEvent } from '../input/inputManager';

export interface PlayerOptions {
  instrument: Instrument;
  step: LessonStep;
  bpm: number;
  timeSig: [number, number];
  metronome: boolean;
  countIn: boolean;
  /** Reproduce las notas de la lección como guía. */
  guide: boolean;
  /** Acompañamiento armónico (lecciones de batería/pads) o rítmico (teclado). */
  backing: boolean;
  /** Loop de compases [inicio, fin) en compases; null = todo el paso. */
  loop: [number, number] | null;
  loopEnabled: boolean;
  waitMode: boolean;
  autoBpm: boolean;
  targetBpm: number;
  /** Compensación de latencia en ms (positivo = el usuario suena tarde). */
  latencyMs: number;
  chords?: { root: number; quality: 'maj' | 'min' | 'dom7' | 'min7' }[];
}

export interface PlayerState {
  status: 'idle' | 'countin' | 'playing' | 'waiting' | 'paused' | 'finished';
  /** Posición actual en negras. */
  beat: number;
  bpm: number;
  hits: HitResult[];
  noteStates: (HitJudgement | null)[];
  streak: number;
  bestStreak: number;
  loopPass: number;
  lastJudgement: { j: HitJudgement; at: number } | null;
  countInBeat: number;
}

export type PlayerListener = (s: PlayerState) => void;

const LOOKAHEAD = 0.25; // s
const TICK_MS = 30;

export class LessonPlayer {
  opts: PlayerOptions;
  state: PlayerState;
  private listeners = new Set<PlayerListener>();
  private timer: number | null = null;
  private startTime = 0; // reloj de audio en el que beat=0 (del rango actual)
  private nextSchedIndex = 0;
  private nextClickBeat = 0;
  private nextChordBeat = 0;
  private unsub: (() => void) | null = null;
  private waitingIndex: number | null = null;
  private pausedAtBeat = 0;
  private rangeStart = 0; // beats
  private rangeEnd = 0;
  private lastStepBeats: number;
  private sortedNotes: (LessonNote & { idx: number })[] = [];
  private stepScores: StepScore[] = [];
  private waitUnsatisfied = new Set<number>();
  private activeGuideKeys = new Map<string, number>();

  constructor(opts: PlayerOptions) {
    this.opts = opts;
    this.lastStepBeats = opts.step.bars * opts.timeSig[0];
    this.state = {
      status: 'idle',
      beat: 0,
      bpm: opts.bpm,
      hits: [],
      noteStates: opts.step.notes.map(() => null),
      streak: 0,
      bestStreak: 0,
      loopPass: 0,
      lastJudgement: null,
      countInBeat: 0,
    };
    this.prepare();
  }

  private prepare() {
    this.sortedNotes = this.opts.step.notes.map((n, idx) => ({ ...n, idx })).sort((a, b) => a.beat - b.beat);
  }

  subscribe(fn: PlayerListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    this.listeners.forEach((l) => l(this.state));
  }

  get beatsPerBar() {
    return this.opts.timeSig[0];
  }
  get totalBeats() {
    return this.lastStepBeats;
  }
  secPerBeat() {
    return 60 / this.state.bpm;
  }
  beatToTime(beat: number) {
    return this.startTime + (beat - this.rangeStart) * this.secPerBeat();
  }
  timeToBeat(t: number) {
    return this.rangeStart + (t - this.startTime) / this.secPerBeat();
  }

  /** Posición actual en negras leída del reloj de audio (suave, para dibujar). */
  currentBeat(): number {
    const st = this.state.status;
    if (st === 'playing' || st === 'countin') return this.timeToBeat(getAudioContext().currentTime);
    return this.state.beat;
  }

  setOptions(patch: Partial<PlayerOptions>) {
    Object.assign(this.opts, patch);
    if (patch.bpm != null && this.state.status === 'idle') this.state.bpm = patch.bpm;
    this.notify();
  }

  private computeRange() {
    if (this.opts.loopEnabled && this.opts.loop) {
      this.rangeStart = this.opts.loop[0] * this.beatsPerBar;
      this.rangeEnd = this.opts.loop[1] * this.beatsPerBar;
    } else {
      this.rangeStart = 0;
      this.rangeEnd = this.totalBeats;
    }
  }

  start(fromPause = false) {
    const ctx = getAudioContext();
    this.computeRange();
    const countBeats = this.opts.countIn && !fromPause ? this.beatsPerBar : 0;
    const beginBeat = fromPause ? this.pausedAtBeat : this.rangeStart;
    this.startTime = ctx.currentTime + 0.08 + countBeats * this.secPerBeat() - (beginBeat - this.rangeStart) * this.secPerBeat();
    if (!fromPause) this.resetPassState();
    this.nextSchedIndex = this.sortedNotes.findIndex((n) => n.beat >= beginBeat - 1e-6);
    if (this.nextSchedIndex < 0) this.nextSchedIndex = this.sortedNotes.length;
    this.nextClickBeat = Math.ceil(beginBeat - 1e-6);
    this.nextChordBeat = Math.floor(beginBeat / this.beatsPerBar) * this.beatsPerBar;
    // cuenta de entrada
    if (countBeats) {
      for (let i = 0; i < countBeats; i++) click(this.startTime - (countBeats - i) * this.secPerBeat(), i === 0);
    }
    this.state.status = countBeats ? 'countin' : 'playing';
    this.state.beat = beginBeat;
    if (!this.unsub) this.unsub = inputManager.subscribe(this.onInput);
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(this.tick, TICK_MS);
    this.notify();
  }

  private resetPassState() {
    this.state.noteStates = this.opts.step.notes.map(() => null);
    this.state.hits = [];
    this.state.streak = 0;
    this.waitUnsatisfied.clear();
    this.waitingIndex = null;
  }

  pause() {
    if (this.state.status !== 'playing' && this.state.status !== 'waiting' && this.state.status !== 'countin') return;
    this.pausedAtBeat = Math.max(this.rangeStart, this.state.beat);
    this.state.status = 'paused';
    this.stopTimer();
    this.notify();
  }
  resume() {
    if (this.state.status !== 'paused') return;
    this.start(true);
  }
  stop() {
    this.stopTimer();
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.state.status = 'idle';
    this.state.beat = 0;
    this.notify();
  }
  destroy() {
    this.stop();
    this.listeners.clear();
  }
  private stopTimer() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Resultado del pase actual (o del último pase completo). */
  currentScore(): StepScore {
    const c = { perfect: 0, early: 0, late: 0, miss: 0, extra: 0, total: this.opts.step.notes.length, bestStreak: this.state.bestStreak };
    // Solo las notas dentro del rango cuentan para el puntaje del pase
    const inRange = this.sortedNotes.filter((n) => n.beat >= this.rangeStart - 1e-6 && n.beat < this.rangeEnd - 1e-6);
    c.total = inRange.length;
    for (const n of inRange) {
      const s = this.state.noteStates[n.idx];
      if (s === 'perfect') c.perfect++;
      else if (s === 'early') c.early++;
      else if (s === 'late') c.late++;
      else c.miss++;
    }
    c.extra = this.state.hits.filter((h) => h.judgement === 'extra').length;
    return computeStepScore(this.opts.step.id, c);
  }
  getStepScores() {
    return this.stepScores;
  }

  private tick = () => {
    const ctx = getAudioContext();
    const nowT = ctx.currentTime;
    const spb = this.secPerBeat();
    if (this.state.status === 'countin') {
      const b = this.timeToBeat(nowT);
      this.state.countInBeat = Math.floor(b - this.rangeStart) + this.beatsPerBar;
      if (b >= this.rangeStart) this.state.status = 'playing';
    }
    if (this.state.status === 'waiting') {
      // Reloj congelado: desplazamos startTime para mantener beat fijo.
      this.startTime = nowT - (this.state.beat - this.rangeStart) * spb;
      this.notify();
      return;
    }
    const beat = this.timeToBeat(nowT);
    this.state.beat = beat;

    // Wait mode: detener en la próxima nota no tocada.
    if (this.opts.waitMode && this.state.status === 'playing') {
      const upcoming = this.sortedNotes.find((n) => this.state.noteStates[n.idx] === null && n.beat >= this.rangeStart - 1e-6 && n.beat < this.rangeEnd - 1e-6 && !this.waitUnsatisfied.has(n.idx));
      if (upcoming && beat >= upcoming.beat) {
        this.state.beat = upcoming.beat;
        this.state.status = 'waiting';
        this.waitingIndex = upcoming.idx;
        this.startTime = nowT - (upcoming.beat - this.rangeStart) * spb;
        this.notify();
        return;
      }
    }

    // Marcar misses cuando se pasó la ventana.
    for (const n of this.sortedNotes) {
      if (n.beat < this.rangeStart - 1e-6) continue;
      if (n.beat >= this.rangeEnd - 1e-6) break;
      if (this.state.noteStates[n.idx] !== null) continue;
      const missAtBeat = n.beat + (TIMING.good / 1000 + this.opts.latencyMs / 1000) / spb;
      if (beat > missAtBeat) {
        this.state.noteStates[n.idx] = 'miss';
        this.state.streak = 0;
        this.state.lastJudgement = { j: 'miss', at: nowT };
        this.state.hits.push({ noteIndex: n.idx, lane: n.lane, judgement: 'miss', deltaMs: 999, time: nowT });
      }
    }

    // Programación de audio con anticipación. En Wait Mode no pasamos de la próxima nota pendiente.
    let horizon = nowT + LOOKAHEAD;
    if (this.opts.waitMode) {
      const pending = this.sortedNotes.find((n) => this.state.noteStates[n.idx] === null && n.beat >= this.rangeStart - 1e-6 && n.beat < this.rangeEnd - 1e-6);
      if (pending) horizon = Math.min(horizon, this.beatToTime(pending.beat) - 0.001);
    }
    // Guía (notas de la lección)
    if (this.opts.guide) {
      while (this.nextSchedIndex < this.sortedNotes.length) {
        const n = this.sortedNotes[this.nextSchedIndex];
        if (n.beat >= this.rangeEnd - 1e-6) break;
        const t = this.beatToTime(n.beat);
        if (t > horizon) break;
        if (t >= nowT - 0.15) playLane(this.opts.instrument, n.lane, Math.max(t, nowT), 0.7, true);
        this.nextSchedIndex++;
      }
    }
    // Metrónomo
    while (this.nextClickBeat < this.rangeEnd - 1e-6) {
      const t = this.beatToTime(this.nextClickBeat);
      if (t > horizon) break;
      if (this.opts.metronome && t >= nowT - 0.08) click(Math.max(t, nowT), this.nextClickBeat % this.beatsPerBar === 0);
      this.nextClickBeat++;
    }
    // Acompañamiento
    if (this.opts.backing) {
      while (this.nextChordBeat < this.rangeEnd - 1e-6) {
        const t = this.beatToTime(this.nextChordBeat);
        if (t > horizon) break;
        if (t >= nowT - 0.02) this.scheduleBar(this.nextChordBeat, Math.max(t, nowT));
        this.nextChordBeat += this.beatsPerBar;
      }
    }

    // Fin del rango
    const endTime = this.beatToTime(this.rangeEnd) + (TIMING.good / 1000 + this.opts.latencyMs / 1000);
    if (nowT >= endTime) {
      this.finishPass();
      return;
    }
    this.notify();
  };

  private scheduleBar(beat: number, t: number) {
    const bar = Math.floor(beat / this.beatsPerBar);
    const spb = this.secPerBeat();
    const chords = this.opts.chords ?? [{ root: 57, quality: 'min' as const }, { root: 53, quality: 'maj' as const }, { root: 48, quality: 'maj' as const }, { root: 55, quality: 'maj' as const }];
    const ch = chords[bar % chords.length];
    if (this.opts.instrument === 'keys') {
      // Batería sencilla de acompañamiento
      for (let b = 0; b < this.beatsPerBar; b++) {
        const tb = t + b * spb;
        playLane('drums', b % 2 === 0 ? 'kick' : 'snare', tb, 0.6, true);
        playLane('drums', 'hihat', tb, 0.35, true);
        playLane('drums', 'hihat', tb + spb / 2, 0.25, true);
      }
      backingChord(ch.root - 12, ch.quality, t, spb * this.beatsPerBar);
    } else {
      backingChord(ch.root, ch.quality, t, spb * this.beatsPerBar);
    }
  }

  private finishPass() {
    const score = this.currentScore();
    this.state.loopPass++;
    const looping = this.opts.loopEnabled;
    if (looping) {
      // Auto BPM: subir 10 BPM si el pase salió bien.
      if (this.opts.autoBpm && score.score >= 90 && this.state.bpm < this.opts.targetBpm) {
        this.state.bpm = Math.min(this.opts.targetBpm, this.state.bpm + 10);
      }
      this.stepScores.push(score);
      this.stopTimer();
      this.start(false);
      return;
    }
    this.stepScores.push(score);
    this.state.status = 'finished';
    this.stopTimer();
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.notify();
  }

  private onInput = (e: InputEvent) => {
    if (e.type === 'off') {
      const g = this.activeGuideKeys.get(e.lane);
      if (g != null) this.activeGuideKeys.delete(e.lane);
      return;
    }
    const st = this.state.status;
    if (st !== 'playing' && st !== 'waiting' && st !== 'countin') return;
    const spb = this.secPerBeat();
    const hitTime = e.time - this.opts.latencyMs / 1000;
    const hitBeat = this.timeToBeat(hitTime);

    if (st === 'waiting' && this.waitingIndex != null) {
      // En Wait Mode aceptamos la nota (o acorde) que está esperando.
      const waitingBeat = this.state.beat;
      const pending = this.sortedNotes.filter((n) => Math.abs(n.beat - waitingBeat) < 1e-6 && this.state.noteStates[n.idx] === null);
      const match = pending.find((n) => n.lane === e.lane);
      if (match) {
        this.state.noteStates[match.idx] = 'perfect';
        this.state.streak++;
        this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
        this.state.lastJudgement = { j: 'perfect', at: e.time };
        this.state.hits.push({ noteIndex: match.idx, lane: match.lane, judgement: 'perfect', deltaMs: 0, time: e.time });
        const stillPending = pending.filter((n) => this.state.noteStates[n.idx] === null);
        if (stillPending.length === 0) {
          // reanudar
          this.state.status = 'playing';
          this.startTime = getAudioContext().currentTime - (waitingBeat - this.rangeStart) * spb + 0.0;
          this.waitingIndex = null;
          // No repetir la guía de las notas que el usuario acaba de tocar.
          const nextIdx = this.sortedNotes.findIndex((n) => n.beat > waitingBeat + 1e-6);
          this.nextSchedIndex = nextIdx < 0 ? this.sortedNotes.length : Math.max(this.nextSchedIndex, nextIdx);
        }
      } else {
        this.state.hits.push({ noteIndex: null, lane: e.lane, judgement: 'extra', deltaMs: 0, time: e.time });
      }
      this.notify();
      return;
    }

    // Buscar la nota más cercana en ese carril, no tocada, dentro de la ventana.
    let best: { idx: number; delta: number } | null = null;
    for (const n of this.sortedNotes) {
      if (n.lane !== e.lane || this.state.noteStates[n.idx] !== null) continue;
      if (n.beat < this.rangeStart - 1e-6 || n.beat >= this.rangeEnd - 1e-6) continue;
      const deltaMs = (hitBeat - n.beat) * spb * 1000;
      if (Math.abs(deltaMs) > TIMING.good) {
        if (deltaMs < -TIMING.good) break; // ya están todas más adelante
        continue;
      }
      if (!best || Math.abs(deltaMs) < Math.abs(best.delta)) best = { idx: n.idx, delta: deltaMs };
    }
    if (best) {
      const j = judge(best.delta);
      this.state.noteStates[best.idx] = j;
      if (j === 'perfect') {
        this.state.streak++;
        this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
      } else this.state.streak = 0;
      this.state.lastJudgement = { j, at: e.time };
      this.state.hits.push({ noteIndex: best.idx, lane: e.lane, judgement: j, deltaMs: Math.round(best.delta), time: e.time });
    } else if (st !== 'countin') {
      this.state.hits.push({ noteIndex: null, lane: e.lane, judgement: 'extra', deltaMs: 0, time: e.time });
    }
    this.notify();
  };
}
