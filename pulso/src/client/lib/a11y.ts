// Filas y celdas que se tocan con el mouse también se activan con el teclado (Enter o Espacio), y
// las ventanas (ajustes, cuenta, nuevo día, revisión, confirmación) atrapan el foco mientras están abiertas.
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';

/** Props para un elemento clicable que no es un botón: foco, rol y activación con Enter o Espacio. */
export function pressable<T extends HTMLElement>(onActivate: () => void, role: 'button' | 'row' | 'option' | null = 'button') {
  return {
    ...(role ? { role } : {}),
    tabIndex: 0,
    onClick: (_e: MouseEvent<T>) => onActivate(),
    onKeyDown: (e: KeyboardEvent<T>) => {
      // Un botón adentro de la fila (quitar, abrir) se maneja solo.
      if (e.target !== e.currentTarget) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onActivate();
    },
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
}

/** Ventanas abiertas, de abajo hacia arriba: solo la de más arriba responde al teclado. */
const stack: HTMLElement[] = [];

/**
 * Trampa de foco para una ventana modal: al abrir, el foco va al primer control (o al que tenga
 * `data-autofocus`; no se usa el `autoFocus` de React porque mueve el foco antes de que se pueda
 * recordar quién abrió la ventana); Tab y Shift+Tab ciclan adentro; Esc cierra; al cerrar, el foco
 * vuelve al botón que la abrió. El elemento de `ref` conviene que tenga `tabIndex={-1}` para recibir
 * el foco si no hay controles. Con `active` en falso la trampa no hace nada (ventana cerrada).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose?: () => void, active = true): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(el);
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    const initial = (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(el)[0]) || el;
    // Después de que el navegador terminó de pintar la ventana (si no, algunos no mueven el foco).
    const raf = requestAnimationFrame(() => initial.focus({ preventScroll: true }));
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === 'Escape') {
        if (!closeRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(el);
      if (!items.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // En captura: se adelanta a los atajos de teclado de la página y al Esc de las herramientas del gráfico.
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      const i = stack.lastIndexOf(el);
      if (i >= 0) stack.splice(i, 1);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
