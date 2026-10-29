import { useRef } from 'react';

/**
 * Devuelve la misma referencia mientras el valor no cambie en contenido (comparado como JSON). Para
 * listas chicas que se arman en cada dibujo (tus órdenes y ejecuciones en el gráfico) y que, sin esto,
 * harían trabajar de más a los componentes memorizados.
 */
export function useStable<T>(value: T): T {
  const ref = useRef<{ key: string; value: T } | null>(null);
  const key = JSON.stringify(value) ?? '';
  if (!ref.current || ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}
