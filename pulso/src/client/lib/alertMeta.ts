import type { AlertType } from '../../engine/types';

export interface AlertMeta {
  label: string;
  short: string;
  group: AlertGroup;
}

export type AlertGroup = 'impulso' | 'patron' | 'halt' | 'info';

export const ALERT_META: Record<AlertType, AlertMeta> = {
  hod: { label: 'Nuevo máximo del día', short: 'HOD', group: 'impulso' },
  nearHod: { label: 'Cerca del máximo', short: 'Cerca HOD', group: 'impulso' },
  running: { label: 'Subiendo rápido', short: 'Sube', group: 'impulso' },
  squeeze: { label: 'Squeeze', short: 'Squeeze', group: 'impulso' },
  volume: { label: 'Pico de volumen', short: 'Volumen', group: 'impulso' },
  stacking: { label: 'Compras apiladas', short: 'Apiladas', group: 'impulso' },
  pmhBreak: { label: 'Rompe máximo pre-market', short: 'Rompe PMH', group: 'impulso' },
  level: { label: 'Rompe nivel redondo', short: 'Nivel', group: 'impulso' },
  bullFlag: { label: 'Bull flag', short: 'Bull flag', group: 'patron' },
  vwapReclaim: { label: 'Recupera VWAP', short: 'VWAP ↑', group: 'patron' },
  vwapLoss: { label: 'Pierde VWAP', short: 'VWAP ↓', group: 'patron' },
  redToGreen: { label: 'Rojo a verde', short: 'Rojo→verde', group: 'patron' },
  flush: { label: 'Flush', short: 'Flush', group: 'patron' },
  halt: { label: 'Halt', short: 'HALT', group: 'halt' },
  resume: { label: 'Reanudación', short: 'Reanuda', group: 'halt' },
  news: { label: 'Noticia', short: 'Noticia', group: 'info' },
  gapper: { label: 'Entra a gappers', short: 'Gapper', group: 'info' },
  rotation: { label: 'Rotación de float', short: 'Rotación', group: 'info' },
  priceLine: { label: 'Alerta de precio', short: 'Precio', group: 'info' },
};

export const GROUP_LABEL: Record<AlertGroup | 'all', string> = {
  all: 'Todas',
  impulso: 'Impulso',
  patron: 'Patrones',
  halt: 'Halts',
  info: 'Noticias y otros',
};

/** Tipos que alimentan el panel "Momentum" (el equivalente al scanner de máximos del día). */
export const MOMENTUM_TYPES: AlertType[] = ['hod', 'squeeze', 'running', 'bullFlag', 'pmhBreak', 'volume'];

export const DEFAULT_SOUND_TYPES: AlertType[] = ['hod', 'squeeze', 'running', 'bullFlag', 'halt', 'resume', 'news', 'pmhBreak', 'priceLine'];
