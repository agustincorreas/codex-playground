import type { Alert, NewsItem, ProviderStatus, Settings, SymbolDetail, ViewModel } from '../../engine/types';

export interface SourceHandlers {
  onView(v: ViewModel): void;
  /** `initial` = historial al conectar (no suena). */
  onAlerts(a: Alert[], initial: boolean): void;
  onNews(n: NewsItem[], initial: boolean): void;
  onDetail(d: SymbolDetail | null): void;
  onStatus(s: ProviderStatus): void;
}

/** Fuente de datos de la interfaz: el simulador local (demo) o el servidor en vivo. */
export interface DataSource {
  readonly kind: 'local' | 'remote';
  start(h: SourceHandlers): void;
  stop(): void;
  select(sym: string | null): void;
  setSettings(s: Settings): void;
  setWatchlist(syms: string[]): void;
  setSpeed(x: number): void;
  search(prefix: string): Promise<string[]>;
  /** Hora de mercado actual (en el demo, la del reloj simulado). */
  now(): number;
}
