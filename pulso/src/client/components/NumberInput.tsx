// Campo numérico de los ajustes: muestra lo que escribís tal cual (acepta "2,5" y "2.5") y guarda el
// valor en cuanto es un número válido. Si lo borrás, el ajuste no cambia y al salir del campo vuelve
// a mostrar el valor guardado (antes, borrar saltaba a 0 y "2,5" se convertía en 25).
import { useRef, useState, type InputHTMLAttributes } from 'react';
import { parseDecimal } from '../lib/format';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
}

/** Texto de un número guardado: sin ceros de más y con punto decimal (como se escribe en el ticket). */
const show = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(6))) : '');

export function NumberInput({ value, onCommit, min, max, ...rest }: Props) {
  const [text, setText] = useState(() => show(value));
  const committed = useRef(value);
  // El valor cambió desde afuera (por ejemplo, "Restablecer"): se muestra el nuevo.
  if (value !== committed.current) {
    committed.current = value;
    const t = show(value);
    if (t !== text) setText(t);
  }
  const change = (raw: string) => {
    setText(raw);
    const v = parseDecimal(raw);
    if (v === undefined || (min !== undefined && v < min) || (max !== undefined && v > max)) return;
    if (v === committed.current) return;
    committed.current = v;
    onCommit(v);
  };
  const blur = () => {
    if (parseDecimal(text) !== committed.current) setText(show(committed.current));
  };
  return <input {...rest} type="text" inputMode="decimal" value={text} onChange={(e) => change(e.target.value)} onBlur={blur} />;
}
