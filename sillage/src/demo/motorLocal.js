// Motor de matching corriendo en el dispositivo (solo modo demo).
// Reutiliza los mismos módulos de scoring que la Cloud Function
// (afinidad.js, engine.js, perfil.js copiados de functions/src/matching)
// y reemplaza las queries de Firestore por filtros en memoria sobre la
// base de muestra.

import { rankear } from './engine';
import {
  construirPerfil, generoObjetivo, precioObjetivo, extraerKeywords,
} from './perfil';
import PERFUMES from './perfumes.json';

function sinAcentos(texto = '') {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Equivalente local de los filtros duros de candidatos.js.
function filtrarCandidatos({ genero, precioRango, soloDisponibles, exclusiones, excluirId }) {
  let candidatos = PERFUMES.slice();

  if (genero && genero !== 'U') {
    candidatos = candidatos.filter((c) => c.genero === genero || c.genero === 'U');
  }
  if (precioRango) candidatos = candidatos.filter((c) => c.precio_rango === precioRango);
  if (soloDisponibles) candidatos = candidatos.filter((c) => !c.discontinuado);
  if (excluirId) candidatos = candidatos.filter((c) => c.id !== excluirId);

  const keywords = extraerKeywords(exclusiones || '');
  if (keywords.length > 0) {
    candidatos = candidatos.filter((c) => {
      const corpus = sinAcentos(
        [
          ...(c.notas_salida || []),
          ...(c.notas_corazon || []),
          ...(c.notas_fondo || []),
          ...(c.descriptores || []),
          c.nombre,
          c.marca,
        ].join(' ')
      );
      return !keywords.some((k) => corpus.includes(k));
    });
  }
  return candidatos;
}

export function recomendarLocal(payload) {
  let referencia = null;
  if (payload.perfume_referencia?.id) {
    referencia = PERFUMES.find((p) => p.id === payload.perfume_referencia.id) || null;
  }

  const perfil = construirPerfil(payload, referencia);
  if (perfil.keywordsExtra.length > 0) {
    perfil.descriptoresObjetivo = [
      ...new Set([...perfil.descriptoresObjetivo, ...perfil.keywordsExtra]),
    ];
  }

  const candidatos = filtrarCandidatos({
    genero: generoObjetivo(payload),
    precioRango: precioObjetivo(payload),
    soloDisponibles: payload.modo === 'B',
    exclusiones: payload.exclusiones || '',
    excluirId: referencia?.id || null,
  });

  const resultados = rankear(perfil, candidatos, 5);
  return { resultados, busquedaId: `demo_${Date.now()}` };
}

export function buscarLocal(texto, { incluirDiscontinuados = true } = {}) {
  const q = sinAcentos(texto.trim());
  if (q.length < 3) return [];
  return PERFUMES.filter((p) => {
    if (!incluirDiscontinuados && p.discontinuado) return false;
    return sinAcentos(p.nombre).includes(q) || sinAcentos(p.marca).includes(q);
  })
    .sort((a, b) => (b.popularidad_score || 0) - (a.popularidad_score || 0))
    .slice(0, 10);
}

// Explicaciones de muestra para previsualizar la experiencia PRO sin IA.
export function enriquecerLocal(resultados, modo, nombreReferencia) {
  const out = {};
  for (const p of resultados || []) {
    const notas = [...(p.notas_fondo || []), ...(p.notas_corazon || [])].slice(0, 3).join(', ');
    out[p.id] = {
      explicacion:
        `[Texto de muestra del modo demo] ${p.nombre} de ${p.marca} matchea con tu búsqueda ` +
        `por su familia ${p.familia_principal?.toLowerCase()} y su fondo de ${notas}. ` +
        `En la versión conectada, esta explicación la escribe el sommelier con IA ` +
        `referenciando exactamente lo que respondiste en el formulario.`,
      cuando_usarlo:
        `Ideal para ${(p.ocasiones || []).slice(0, 2).join(' y ') || 'uso diario'}. ` +
        `Intensidad ${p.intensidad}/5: dosificá según la ocasión.`,
      por_que_reemplaza:
        modo === 'B'
          ? `[Muestra] Comparte estructura de notas con ${nombreReferencia || 'tu perfume'}; ` +
            `la comparación nota por nota la genera la IA en la versión conectada.`
          : null,
    };
  }
  return out;
}
