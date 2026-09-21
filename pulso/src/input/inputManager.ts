// Gestor de entrada unificado: MIDI, teclado de computadora y pantalla táctil.
import type { Instrument } from '../engine/types';
import { laneForKey, laneForMidi } from '../engine/instruments';
import { getAudioContext } from '../audio/engine';

export interface InputEvent {
  lane: string;
  /** Tiempo en el reloj de audio (segundos). */
  time: number;
  velocity: number;
  source: 'midi' | 'keyboard' | 'touch';
  type: 'on' | 'off';
}

type Listener = (e: InputEvent) => void;

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

class InputManager {
  private listeners = new Set<Listener>();
  private instrument: Instrument = 'drums';
  private octaveShift = 0;
  private midiAccess: MIDIAccess | null = null;
  private selectedDevice: string | 'all' = 'all';
  private held = new Set<string>();
  private keyboardEnabled = true;
  private deviceListeners = new Set<(d: MidiDeviceInfo[]) => void>();
  public midiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  public lastMidiActivity = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
    }
  }

  setInstrument(i: Instrument) {
    this.instrument = i;
  }
  setOctaveShift(s: number) {
    this.octaveShift = s;
  }
  getOctaveShift() {
    return this.octaveShift;
  }
  setKeyboardEnabled(v: boolean) {
    this.keyboardEnabled = v;
  }
  setDevice(id: string | 'all') {
    this.selectedDevice = id;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onDevicesChange(fn: (d: MidiDeviceInfo[]) => void): () => void {
    this.deviceListeners.add(fn);
    return () => this.deviceListeners.delete(fn);
  }

  emit(e: InputEvent) {
    this.listeners.forEach((l) => l(e));
  }

  /** Emisión desde la UI táctil. */
  touch(lane: string, type: 'on' | 'off' = 'on', velocity = 1) {
    this.emit({ lane, time: getAudioContext().currentTime, velocity, source: 'touch', type });
  }

  private isTypingTarget(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keyboardEnabled || e.repeat || this.isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.instrument === 'keys') {
      if (e.code === 'KeyZ') {
        this.octaveShift = Math.max(-2, this.octaveShift - 1);
        return;
      }
      if (e.code === 'KeyX') {
        this.octaveShift = Math.min(2, this.octaveShift + 1);
        return;
      }
    }
    const lane = laneForKey(this.instrument, e.code, this.octaveShift);
    if (!lane) return;
    e.preventDefault();
    if (this.held.has(e.code)) return;
    this.held.add(e.code);
    this.emit({ lane, time: getAudioContext().currentTime, velocity: 0.9, source: 'keyboard', type: 'on' });
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.held.has(e.code)) return;
    this.held.delete(e.code);
    const lane = laneForKey(this.instrument, e.code, this.octaveShift);
    if (lane) this.emit({ lane, time: getAudioContext().currentTime, velocity: 0, source: 'keyboard', type: 'off' });
  };

  async initMidi(): Promise<MidiDeviceInfo[]> {
    if (!this.midiSupported) return [];
    if (!this.midiAccess) {
      try {
        this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      } catch {
        this.midiSupported = false;
        return [];
      }
      this.midiAccess.onstatechange = () => {
        this.bindInputs();
        const devs = this.devices();
        this.deviceListeners.forEach((l) => l(devs));
      };
      this.bindInputs();
    }
    return this.devices();
  }

  devices(): MidiDeviceInfo[] {
    if (!this.midiAccess) return [];
    const out: MidiDeviceInfo[] = [];
    this.midiAccess.inputs.forEach((inp) => out.push({ id: inp.id, name: inp.name ?? 'MIDI', manufacturer: inp.manufacturer ?? '' }));
    return out;
  }

  private bindInputs() {
    if (!this.midiAccess) return;
    this.midiAccess.inputs.forEach((inp) => {
      inp.onmidimessage = (msg: MIDIMessageEvent) => this.onMidi(inp.id, msg);
    });
  }

  private onMidi(deviceId: string, msg: MIDIMessageEvent) {
    if (this.selectedDevice !== 'all' && this.selectedDevice !== deviceId) return;
    const data = msg.data;
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    const note = data[1];
    const vel = data[2];
    this.lastMidiActivity = Date.now();
    const isOn = status === 0x90 && vel > 0;
    const isOff = status === 0x80 || (status === 0x90 && vel === 0);
    if (!isOn && !isOff) return;
    const lane = laneForMidi(this.instrument, note);
    if (!lane) return;
    this.emit({ lane, time: getAudioContext().currentTime, velocity: vel / 127, source: 'midi', type: isOn ? 'on' : 'off' });
  }
}

export const inputManager = new InputManager();
