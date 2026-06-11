const OpenAI = require('openai');

// Enriquecimiento premium: el motor gratuito ya calculó el top 5;
// acá se genera la capa de explicaciones con GPT-4o.

const SYSTEM_PROMPT = `Sos un sommelier de fragancias experto en el mercado hispanohablante.
Se te da un perfume recomendado y el perfil del usuario que lo busca.
Escribí en español rioplatense, tono cálido y técnico a la vez, sin ser pomposo.
Tu tarea es escribir:
1. explicacion: por qué este perfume específico es ideal para ESTE usuario, referenciando sus preferencias concretas. Máximo 120 palabras.
2. cuando_usarlo: dos o tres frases sobre momentos y contextos ideales de uso.
3. por_que_reemplaza: solo si es modo B (reemplazo de discontinuado), comparación específica de qué notas conectan ambos perfumes. Null en otros modos.
Respondé ÚNICAMENTE en JSON:
{
  "explicacion": string,
  "cuando_usarlo": string,
  "por_que_reemplaza": string | null
}`;

const SYSTEM_PROMPT_CHAT = `Sos un sommelier de fragancias experto en el mercado hispanohablante.
Conversás en español rioplatense, tono cálido y técnico a la vez, sin ser pomposo.
Tenés el contexto de la búsqueda del usuario y sus recomendaciones actuales.
Ayudalo a refinar: sugerí ajustes concretos (familias, notas, intensidad,
presupuesto) y, si te pide alternativas, basate en los perfumes del contexto.
Respuestas breves: máximo 100 palabras por turno.`;

function cliente() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function describirPerfume(p) {
  return {
    nombre: p.nombre,
    marca: p.marca,
    familia: p.familia_principal,
    notas_salida: p.notas_salida,
    notas_corazon: p.notas_corazon,
    notas_fondo: p.notas_fondo,
    descriptores: p.descriptores,
    score: p.score,
    desglose: p.desglose,
  };
}

/**
 * Genera la explicación de UNA recomendación.
 * @returns {{explicacion, cuando_usarlo, por_que_reemplaza}}
 */
async function enriquecerRecomendacion({ perfume, input, referencia }) {
  const respuesta = await cliente().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          modo: input.modo,
          perfil_usuario: input,
          perfume_recomendado: describirPerfume(perfume),
          perfume_referencia: referencia ? describirPerfume(referencia) : null,
        }),
      },
    ],
  });
  return JSON.parse(respuesta.choices[0].message.content);
}

/**
 * Turno del chat conversacional, pre-cargado con el contexto de la búsqueda.
 * @param {object} contexto  { input, resultados }
 * @param {Array} mensajes   [{ role: 'user'|'assistant', content }]
 */
async function turnoChat(contexto, mensajes) {
  const respuesta = await cliente().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CHAT },
      {
        role: 'system',
        content: `Contexto de la búsqueda: ${JSON.stringify({
          input: contexto.input,
          recomendaciones: (contexto.resultados || []).map(describirPerfume),
        })}`,
      },
      ...mensajes.slice(-12), // ventana acotada para controlar costo
    ],
  });
  return respuesta.choices[0].message.content;
}

module.exports = { enriquecerRecomendacion, turnoChat };
