// La IA que opina sobre los trades: dentro de Claude, la de la página (`sample`); con el servidor de
// Pulso, Claude por la API con la clave guardada en el servidor (`/api/ai`). Si no hay ninguna, null.
import { claudeSampler } from './review';

export type Asker = (system: string, prompt: string) => Promise<string>;

export type AiLink = { ask: Asker; via: 'claude' | 'servidor' };

let cached: Promise<AiLink | null> | undefined;
/** Si no se encontró ninguna IA, se vuelve a buscar pasado este tiempo (el servidor puede estar arrancando). */
const RETRY_MS = 60_000;

export function aiAvailable(): Promise<AiLink | null> {
  if (!cached) {
    const attempt = detect().catch(() => null);
    cached = attempt;
    void attempt.then((ai) => {
      if (ai) return;
      setTimeout(() => {
        if (cached === attempt) cached = undefined;
      }, RETRY_MS);
    });
  }
  return cached;
}

async function detect(): Promise<AiLink | null> {
  const sampler = await claudeSampler();
  if (sampler) {
    return { via: 'claude', ask: async (system, prompt) => (await sampler(`${system}\n\n${prompt}`)).text };
  }
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (!r.ok) return null;
    const h = (await r.json()) as { ai?: boolean };
    if (!h.ai) return null;
  } catch {
    return null;
  }
  return {
    via: 'servidor',
    ask: async (system, prompt) => {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, prompt }) });
      const body = (await r.json()) as { text?: string; error?: string };
      if (!r.ok || body.error) throw new Error(body.error ?? `HTTP ${r.status}`);
      return body.text ?? '';
    },
  };
}
