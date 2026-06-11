import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

// Motor de matching (tier gratuito). Devuelve { resultados, busquedaId }.
export async function pedirRecomendaciones(payload) {
  const fn = httpsCallable(functions, 'recomendar');
  const { data } = await fn(payload);
  return data;
}

// Enriquecimiento premium con GPT-4o sobre un set de resultados ya calculado.
export async function pedirEnriquecimiento(busquedaId) {
  const fn = httpsCallable(functions, 'enriquecerPremium');
  const { data } = await fn({ busquedaId });
  return data; // { [perfumeId]: { explicacion, cuando_usarlo, por_que_reemplaza } }
}

// Chat conversacional del sommelier (premium).
export async function chatSommelier(busquedaId, mensajes) {
  const fn = httpsCallable(functions, 'chatSommelier');
  const { data } = await fn({ busquedaId, mensajes });
  return data; // { respuesta }
}
