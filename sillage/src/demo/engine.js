const { sonAdyacentes } = require('./afinidad');

// Motor de scoring 0-100. Sin IA: puro matching de atributos.
//
// Dimensiones y pesos máximos:
//   notas (35) + familia (25) + descriptores (20) + ocasion (10)
//   + intensidad (5) + popularidad (5) = 100

const MIN_VOTOS = 50;
const UMBRAL_MATCH_ALTO = 80;

function interseccion(a = [], b = []) {
  const setB = new Set((b || []).map((x) => String(x).toLowerCase().trim()));
  return (a || []).filter((x) => setB.has(String(x).toLowerCase().trim()));
}

// 1. COMPATIBILIDAD DE NOTAS — máx 35
//    - notas en común (cualquier posición): +3 c/u, máx 15
//    - notas de fondo en común: +6 c/u, máx 12
//    - notas de salida en común: +3 c/u, máx 8
function puntosNotas(referencia, candidato) {
  if (!referencia) return 0;
  const todasRef = [
    ...(referencia.notas_salida || []),
    ...(referencia.notas_corazon || []),
    ...(referencia.notas_fondo || []),
  ];
  const todasCand = [
    ...(candidato.notas_salida || []),
    ...(candidato.notas_corazon || []),
    ...(candidato.notas_fondo || []),
  ];
  const comunes = Math.min(interseccion(todasRef, todasCand).length * 3, 15);
  const fondo = Math.min(
    interseccion(referencia.notas_fondo, candidato.notas_fondo).length * 6,
    12
  );
  const salida = Math.min(
    interseccion(referencia.notas_salida, candidato.notas_salida).length * 3,
    8
  );
  return comunes + fondo + salida;
}

// 2. FAMILIA OLFATIVA — máx 25
function puntosFamilia(familiaObjetivo, familiasSecundariasObjetivo, candidato) {
  if (!familiaObjetivo) return 0;
  if (candidato.familia_principal === familiaObjetivo) return 25;
  const secundariasComunes = interseccion(
    familiasSecundariasObjetivo || [],
    [candidato.familia_principal, ...(candidato.familias_secundarias || [])]
  );
  if (
    secundariasComunes.length > 0 ||
    (candidato.familias_secundarias || []).includes(familiaObjetivo)
  ) {
    return 15;
  }
  if (sonAdyacentes(familiaObjetivo, candidato.familia_principal)) return 10;
  return 0;
}

// 3. DESCRIPTORES — máx 20 (+4 por descriptor en común)
function puntosDescriptores(descriptoresObjetivo, candidato) {
  return Math.min(
    interseccion(descriptoresObjetivo, candidato.descriptores).length * 4,
    20
  );
}

// 4. OCASIÓN — máx 10 (+5 por ocasión en común)
function puntosOcasion(ocasionesObjetivo, candidato) {
  return Math.min(
    interseccion(ocasionesObjetivo, candidato.ocasiones).length * 5,
    10
  );
}

// 5. INTENSIDAD — máx 5
function puntosIntensidad(intensidadDeseada, candidato) {
  if (!intensidadDeseada || !candidato.intensidad) return 0;
  const diff = Math.abs(intensidadDeseada - candidato.intensidad);
  if (diff === 0) return 5;
  if (diff === 1) return 3;
  if (diff === 2) return 1;
  return 0;
}

// 6. POPULARIDAD — máx 5, proporcional a rating y votos
function puntosPopularidad(candidato) {
  const rating = candidato.rating || 0;           // 0-10
  const votos = candidato.votos || 0;
  const factorVotos = Math.min(votos / 1000, 1);  // satura en 1000 votos
  return Math.round((rating / 10) * factorVotos * 5 * 10) / 10;
}

/**
 * Calcula score y desglose de un candidato contra el perfil objetivo.
 * `perfil` = {
 *   referencia,                  // doc del perfume de referencia o null
 *   familiaObjetivo, familiasSecundariasObjetivo,
 *   descriptoresObjetivo, ocasionesObjetivo,
 *   intensidadDeseada,
 *   pesoSimilitud,               // 0-1: slider similitud/fidelidad (modos A y B)
 * }
 */
function calcularScore(perfil, candidato) {
  const desglose = {
    notas: puntosNotas(perfil.referencia, candidato),
    familia: puntosFamilia(
      perfil.familiaObjetivo,
      perfil.familiasSecundariasObjetivo,
      candidato
    ),
    descriptores: puntosDescriptores(perfil.descriptoresObjetivo, candidato),
    ocasion: puntosOcasion(perfil.ocasionesObjetivo, candidato),
    intensidad: puntosIntensidad(perfil.intensidadDeseada, candidato),
    popularidad: puntosPopularidad(candidato),
  };

  // Slider similitud/fidelidad: cerca de "clon exacto" pondera más notas
  // y familia; cerca de "diferente pero afín" las relaja.
  if (perfil.pesoSimilitud != null && perfil.referencia) {
    const w = 0.6 + perfil.pesoSimilitud * 0.4; // 0.6 a 1.0
    desglose.notas = Math.round(desglose.notas * w * 10) / 10;
    desglose.familia = Math.round(desglose.familia * w * 10) / 10;
  }

  let score = Object.values(desglose).reduce((a, b) => a + b, 0);

  // Sin perfume de referencia (modos C y D) las dimensiones notas+familia
  // aportan menos: normalizamos para que el score siga siendo comparable
  // sobre 100.
  if (!perfil.referencia) {
    const maxPosible = (perfil.familiaObjetivo ? 25 : 0) + 20 + 10 + 5 + 5;
    score = (score / maxPosible) * 100;
  }

  return { score: Math.round(score * 10) / 10, desglose };
}

/**
 * Rankea candidatos y devuelve el top N.
 * Evita perfumes con menos de 50 votos salvo match muy alto (>80).
 */
function rankear(perfil, candidatos, topN = 5) {
  return candidatos
    .map((c) => {
      const { score, desglose } = calcularScore(perfil, c);
      return { ...c, score, desglose };
    })
    .filter((c) => (c.votos || 0) >= MIN_VOTOS || c.score > UMBRAL_MATCH_ALTO)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = { calcularScore, rankear, interseccion };
