// Filas y celdas que se tocan con el mouse también se activan con el teclado (Enter o Espacio).
import type { KeyboardEvent, MouseEvent } from 'react';

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
