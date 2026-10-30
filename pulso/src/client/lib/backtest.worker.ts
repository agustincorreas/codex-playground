// Worker del backtest: corre los días pedidos fuera del hilo de la interfaz y va mandando el avance,
// cada día terminado y el final (o el error). Se crea desde Backtest.tsx con
// `new Worker(new URL('./backtest.worker.ts', import.meta.url), { type: 'module' })`.
import { runBacktest, type BacktestMessage, type BacktestRequest } from './backtest';

const worker = self as unknown as { postMessage(m: BacktestMessage): void; onmessage: ((e: MessageEvent<BacktestRequest>) => void) | null };

worker.onmessage = (e) => {
  const req = e.data;
  if (req?.type !== 'run') return;
  void runBacktest(req.days, req.setup, (m) => worker.postMessage(m));
};
