import type { Alert, NewsItem, ProviderStatus, Quote, ScanRow, Settings, SymbolDetail, ViewModel } from '../../engine/types';

export interface SourceHandlers {
  onView(v: ViewModel): void;
  /** `initial` = historial al conectar (no suena). */
  onAlerts(a: Alert[], initial: boolean): void;
  onNews(n: NewsItem[], initial: boolean): void;
  onDetail(d: SymbolDetail | null): void;
  onStatus(s: ProviderStatus): void;
  /** Cada vez que avanza el mercado (para ejecutar las órdenes de práctica). */
  onTick?(now: number): void;
}

/** Fuente de datos de la interfaz: el simulador local o el servidor en vivo. */
export interface DataSource {
  readonly kind: 'local' | 'remote';
  start(h: SourceHandlers): void;
  stop(): void;
  select(sym: string | null): void;
  setSettings(s: Settings): void;
  setWatchlist(syms: string[]): void;
  /** Símbolos con posición u órdenes de práctica: se siguen aunque no estén en ningún escáner. */
  setTracked(syms: string[]): void;
  setSpeed(x: number): void;
  search(prefix: string): Promise<string[]>;
  /** Hora de mercado actual (en el simulador, la del reloj simulado). */
  now(): number;
  quote(sym: string): Quote | null;
  row(sym: string): ScanRow | null;
  /** Velas de 1 minuto [t, o, h, l, c, v] para guardar con un trade. */
  reviewBars(sym: string, from: number, to: number): number[][] | undefined;
}
