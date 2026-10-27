import type { Alert, Bar, NewsItem, ProviderStatus, Quote, ScanRow, Session, Settings, SymbolDetail, TapePrint, ViewModel } from '../../engine/types';
import type { HistoryTf } from '../../engine/history';
import type { DepthBook } from '../../trading/depth';

export interface SourceHandlers {
  onView(v: ViewModel): void;
  /** `initial` = historial al conectar (no suena). */
  onAlerts(a: Alert[], initial: boolean): void;
  onNews(n: NewsItem[], initial: boolean): void;
  onDetail(d: SymbolDetail | null): void;
  onStatus(s: ProviderStatus): void;
  /** Cada vez que avanza el mercado (para ejecutar las órdenes de práctica). */
  onTick?(now: number): void;
  /** Mientras se pone al día (todavía no se puede operar): trabajar las órdenes con lo que pasó. */
  onCatchUp?(now: number): void;
  /** Se rearmó el mercado (otro motor): las órdenes en cola vuelven a medir la cinta desde ahora. */
  onRebuild?(): void;
  /** Otro dispositivo cambió la cuenta de práctica guardada en el servidor. */
  onAccount?(rev: number): void;
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
  /** El mercado terminó de generarse o de reanudarse: recién ahí se puede operar y guardar la hora. */
  readonly ready: boolean;
  /** Level 2: libro con profundidad sincronizado a este momento. */
  book(sym: string): DepthBook | null;
  /** true si el Level 2 es el del mercado (simulador); false si solo se estima para ejecutar. */
  readonly depthIsReal: boolean;
  /** Prints de la cinta posteriores a `seq` (para las órdenes límite en cola). */
  printsSince(sym: string, seq: number): TapePrint[];
  lastSeq(): number;
  session(now: number): Session;
  /** Historia para el gráfico (días anteriores, horas o días), ordenada; [] si no hay. */
  history?(sym: string, tf: HistoryTf): Promise<Bar[]>;
  /** La acción que mira el IA Trader (aparte de la seleccionada): recibe su ficha completa. */
  focus?(sym: string | null): void;
  focusDetail?(): SymbolDetail | null;
}
