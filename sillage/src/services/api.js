import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { DEMO } from '../config/demo';
import { recomendarLocal, enriquecerLocal } from '../demo/motorLocal';

// Motor de matching (tier gratuito). Devuelve { resultados, busquedaId }.
// En modo demo corre localmente sobre la base de muestra.
export async function pedirRecomendaciones(payload) {
  if (DEMO) {
    // Pequeña pausa para que se aprecie la pantalla de procesamiento.
    await new Promise((r) => setTimeout(r, 2500));
    return recomendarLocal(payload);
  }
  const fn = httpsCallable(functions, 'recomendar');
  const { data } = await fn(payload);
  return data;
}

// Enriquecimiento premium con GPT-4o sobre un set de resultados ya calculado.
// En demo devuelve textos de muestra para previsualizar la experiencia PRO.
export async function pedirEnriquecimiento(busquedaId, contextoDemo) {
  if (DEMO) {
    return enriquecerLocal(
      contextoDemo?.resultados,
      contextoDemo?.modo,
      contextoDemo?.nombreReferencia
    );
  }
  const fn = httpsCallable(functions, 'enriquecerPremium');
  const { data } = await fn({ busquedaId });
  return data; // { [perfumeId]: { explicacion, cuando_usarlo, por_que_reemplaza } }
}

// Chat conversacional del sommelier (premium).
export async function chatSommelier(busquedaId, mensajes) {
  if (DEMO) {
    return {
      respuesta:
        'Estás en modo demo: acá el chat no está conectado a la IA. En la versión ' +
        'completa converso con vos sobre tu búsqueda y refino las recomendaciones ' +
        'en tiempo real.',
    };
  }
  const fn = httpsCallable(functions, 'chatSommelier');
  const { data } = await fn({ busquedaId, mensajes });
  return data; // { respuesta }
}
