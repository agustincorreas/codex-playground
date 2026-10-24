// Sonidos sintetizados (Web Audio, sin archivos) y voz opcional con speechSynthesis.
import type { Alert } from '../../engine/types';
import { ALERT_META } from './alertMeta';

let ctx: AudioContext | null = null;
let lastBeep = 0;

/** iOS/Safari exigen un toque del usuario antes de reproducir audio. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain = 0.07): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function beep(alert: Alert): void {
  if (!ctx || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - lastBeep < 350) return;
  lastBeep = now;
  const t = ctx.currentTime;
  switch (alert.type) {
    case 'halt':
      tone(330, t, 0.18, 'square', 0.05);
      tone(247, t + 0.2, 0.25, 'square', 0.05);
      break;
    case 'resume':
      tone(392, t, 0.12, 'triangle');
      tone(523, t + 0.13, 0.18, 'triangle');
      break;
    case 'news':
      tone(880, t, 0.1, 'sine');
      tone(880, t + 0.15, 0.1, 'sine');
      break;
    case 'bullFlag':
    case 'squeeze':
      tone(660, t, 0.08, 'triangle');
      tone(880, t + 0.09, 0.08, 'triangle');
      tone(1175, t + 0.18, 0.14, 'triangle');
      break;
    default:
      tone(alert.tone === 'down' ? 440 : 784, t, 0.12, 'sine');
  }
}

let voiceBusy = 0;

export function speak(alert: Alert, lang: 'es' | 'en'): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (voiceBusy > 2) return;
    // Las letras del ticker separadas se entienden mejor: "Q V N T".
    const letters = alert.sym.split('').join(' ');
    const label = lang === 'es' ? ALERT_META[alert.type].label : alert.type;
    const u = new SpeechSynthesisUtterance(`${letters}. ${label}`);
    u.lang = lang === 'es' ? 'es-AR' : 'en-US';
    u.rate = 1.15;
    voiceBusy++;
    u.onend = u.onerror = () => {
      voiceBusy = Math.max(0, voiceBusy - 1);
    };
    synth.speak(u);
  } catch {
    // Sin síntesis de voz disponible.
  }
}
