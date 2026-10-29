// Atajos de teclado configurables: cómo se muestran, cómo se reconocen y cómo se graban.
import type { Hotkey } from '../../trading/types';

const REF = { ask: 'Ask', bid: 'Bid', last: 'Últ.' } as const;
const off = (o: number) => (o === 0 ? '' : `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(2).replace(/^0/, '')}`);

/**
 * Etiqueta corta para un botón rápido (como "Buy 100 on +05" o "Sell Bid Full Bid -05"). Con un corto
 * abierto (`side` = 'short') los atajos se espejan: "Vende todo Bid−.05" pasa a "Cubre todo Ask+.05".
 */
export function shortLabel(h: Hotkey, ticketShares: number, side: 'long' | 'short' = 'long'): string {
  const a = h.action;
  if (a.kind === 'cancel') return 'Cancelar órdenes';
  if (a.kind === 'breakeven') return 'Stop a BE';
  if (a.kind === 'buy') {
    const q = a.shares === 'ticket' ? String(ticketShares || '') : a.shares === 'risk' ? 'riesgo' : String(a.shares);
    if (side === 'short') return `Cubre ${a.shares === 'risk' ? 'todo' : q} ${REF[a.ref]}${off(a.offset)}`;
    return `Compra ${q} ${REF[a.ref]}${off(a.offset)}`;
  }
  const part = a.fraction >= 1 ? 'todo' : a.fraction === 0.5 ? '½' : a.fraction === 0.25 ? '¼' : `${Math.round(a.fraction * 100)}%`;
  if (side === 'short') {
    const ref = a.ref === 'bid' ? 'ask' : a.ref === 'ask' ? 'bid' : 'last';
    return `Cubre ${part} ${REF[ref]}${off(-a.offset)}`;
  }
  return `Vende ${part} ${REF[a.ref]}${off(a.offset)}`;
}

const CODE_LABEL: Record<string, string> = { Escape: 'Esc', Space: 'Espacio', Enter: 'Enter', Backspace: '⌫', Tab: 'Tab' };

/** Nombre corto de una tecla física (KeyboardEvent.code): 'Digit1' → '1', 'KeyQ' → 'Q'. */
export function codeLabel(code: string): string {
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  return code;
}

export function hotkeyLabel(h: Pick<Hotkey, 'code' | 'shift' | 'ctrl' | 'alt'>): string {
  return `${h.ctrl ? 'Ctrl+' : ''}${h.alt ? 'Alt+' : ''}${h.shift ? '⇧' : ''}${codeLabel(h.code)}`;
}

export function matches(h: Hotkey, e: KeyboardEvent): boolean {
  return h.enabled && e.code === h.code && e.shiftKey === h.shift && (e.ctrlKey || e.metaKey) === h.ctrl && e.altKey === h.alt;
}

const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock']);

/** Tecla grabada desde un evento (null si solo se apretó un modificador). */
export function fromEvent(e: KeyboardEvent | React.KeyboardEvent): Pick<Hotkey, 'code' | 'shift' | 'ctrl' | 'alt'> | null {
  if (MODIFIERS.has(e.code)) return null;
  return { code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
}

/** Combinaciones que el navegador no deja usar o que conviene no pisar (copiar, pegar, recargar...). */
export function reserved(k: Pick<Hotkey, 'code' | 'shift' | 'ctrl' | 'alt'>): boolean {
  if (!k.ctrl) return false;
  return ['KeyC', 'KeyV', 'KeyX', 'KeyR', 'KeyT', 'KeyW', 'KeyN', 'KeyL', 'KeyF', 'KeyP', 'KeyS', 'KeyA', 'KeyZ'].includes(k.code);
}

/** ¿El foco está en un campo donde se escribe? Ahí los atajos no actúan (salvo Esc). */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}
