// Sonidos sintetizados (Web Audio, sin archivos) y voz opcional con speechSynthesis.
import type { Alert, AlertType } from '../../engine/types';
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

const EN_LABEL: Partial<Record<AlertType, string>> = {
  hod: 'new high of day',
  nearHod: 'near high of day',
  running: 'running up',
  squeeze: 'squeeze',
  volume: 'volume spike',
  stacking: 'buyers stacking',
  pmhBreak: 'pre-market high break',
  level: 'breaking a round number',
  priceLine: 'price alert',
  bullFlag: 'bull flag',
  vwapReclaim: 'VWAP reclaim',
  vwapLoss: 'lost VWAP',
  redToGreen: 'red to green',
  flush: 'flush',
  halt: 'halted',
  resume: 'resumed',
  news: 'news',
  gapper: 'new gapper',
  rotation: 'float rotation',
};

/** Una voz del idioma pedido, si el sistema tiene (las de Google o las del teléfono suenan mejor). */
function voiceFor(synth: SpeechSynthesis, lang: 'es' | 'en'): SpeechSynthesisVoice | undefined {
  const all = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  const pref = lang === 'es' ? ['es-ar', 'es-419', 'es-us', 'es-mx', 'es-es'] : ['en-us', 'en-gb'];
  for (const code of pref) {
    const v = all.find((x) => x.lang.toLowerCase() === code);
    if (v) return v;
  }
  return all[0];
}

/** Lee la alerta en voz alta: "V I O. Squeeze. Sube 45 por ciento." */
export function speak(alert: Alert, lang: 'es' | 'en'): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (voiceBusy > 2) return;
    // Las letras del ticker separadas se entienden mejor: "Q V N T".
    const letters = alert.sym.split('').join(' ');
    const label = lang === 'es' ? ALERT_META[alert.type].label : (EN_LABEL[alert.type] ?? alert.type);
    const pct = Math.round(alert.changePct);
    const move =
      alert.type === 'halt' || alert.type === 'resume' || !Number.isFinite(pct) || pct === 0
        ? ''
        : lang === 'es'
          ? `${pct > 0 ? 'Sube' : 'Baja'} ${Math.abs(pct)} por ciento`
          : `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)} percent`;
    const u = new SpeechSynthesisUtterance([letters, label, move].filter(Boolean).join('. '));
    u.lang = lang === 'es' ? 'es-AR' : 'en-US';
    const v = voiceFor(synth, lang);
    if (v) u.voice = v;
    u.rate = 1.1;
    voiceBusy++;
    u.onend = u.onerror = () => {
      voiceBusy = Math.max(0, voiceBusy - 1);
    };
    synth.speak(u);
  } catch {
    // Sin síntesis de voz disponible.
  }
}

/**
 * Una moneda que cae: dos parciales metálicos agudos, no armónicos entre sí, con ataque instantáneo y
 * caída rápida (lo que hace "clink" una moneda sobre otra). `pitch` sube o baja el tono.
 */
function coin(start: number, pitch = 1, gain = 0.06): void {
  if (!ctx) return;
  for (const [f, g, dur] of [
    [2540 * pitch, gain, 0.16],
    [3720 * pitch, gain * 0.55, 0.11],
    [5160 * pitch, gain * 0.25, 0.07],
  ] as const) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    amp.gain.setValueAtTime(g, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

/**
 * Sonidos de las órdenes de práctica, uno distinto para cada cosa (como en TradingView): compra y
 * venta ejecutadas suenan a monedas (dos que suben al comprar, tres que bajan al vender) para que se
 * distingan del resto; trade cerrado con ganancia o con pérdida, ejecución parcial, orden en espera,
 * cancelada y rechazada siguen con sus notas.
 */
export function playOrder(kind: 'buy' | 'sell' | 'win' | 'loss' | 'partial' | 'placed' | 'canceled' | 'rejected'): void {
  if (!ctx) unlockAudio();
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  switch (kind) {
    case 'buy':
      coin(t, 0.92);
      coin(t + 0.09, 1.08);
      break;
    case 'sell':
      coin(t, 1.08);
      coin(t + 0.08, 0.97);
      coin(t + 0.17, 0.86);
      break;
    case 'win':
      tone(784, t, 0.07, 'sine', 0.09);
      tone(988, t + 0.08, 0.07, 'sine', 0.09);
      tone(1319, t + 0.16, 0.2, 'sine', 0.09);
      break;
    case 'loss':
      tone(466, t, 0.12, 'triangle', 0.08);
      tone(349, t + 0.13, 0.22, 'triangle', 0.08);
      break;
    case 'partial':
      tone(1047, t, 0.05, 'triangle', 0.07);
      break;
    case 'placed':
      tone(660, t, 0.06, 'sine', 0.07);
      break;
    case 'canceled':
      tone(523, t, 0.08, 'sine', 0.08);
      tone(392, t + 0.09, 0.12, 'sine', 0.08);
      break;
    case 'rejected':
      tone(196, t, 0.1, 'square', 0.05);
      tone(196, t + 0.14, 0.12, 'square', 0.05);
      break;
  }
}
