// Claude por la API de Anthropic, para el IA Trader: una pregunta corta (el estado del mercado y un plan)
// y una respuesta en JSON. La clave vive en el servidor; la página nunca la ve.
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;
let clientKey = '';

/** Una consulta: respuesta rápida (esfuerzo bajo) y con reserva automática si el modelo la rechaza. */
export async function askClaude(apiKey: string, model: string, system: string, prompt: string): Promise<string> {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
    clientKey = apiKey;
  }
  const res = await client.beta.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude no quiso responder esta consulta.');
  return res.content
    .filter((b): b is Extract<(typeof res.content)[number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
