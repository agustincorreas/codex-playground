// Traduce las respuestas del wizard (modos A/B/C/D) al perfil objetivo
// que consume el motor de scoring.

// Mapeo de chips "¿qué te gustó?" y descripciones libres a descriptores
// del esquema de la base.
const CHIP_A_DESCRIPTOR = {
  'Sus notas de fondo': null, // se refleja en el peso de notas de fondo
  'Su estela': 'proyección',
  'Su duración': 'persistente',
  'Su frescura': 'fresco',
  'Su calidez': 'cálido',
  'Su intensidad': 'intenso',
  'Su elegancia': 'elegante',
  'Su rareza': 'distintivo',
  'Su precio-performance': null,
  'Su versatilidad': 'versátil',
};

const CONTEXTO_A_OCASION = {
  Trabajo: 'trabajo',
  'Salidas nocturnas': 'noche',
  'Uso diario': 'diario',
  Verano: 'verano',
  Invierno: 'invierno',
  Deportes: 'deporte',
  'Eventos formales': 'formal',
  'Romántico': 'romántico',
  'Fin de semana': 'casual',
};

// Modo C: cada ocasión define ocasiones y descriptores objetivo.
const OCASION_PERFIL = {
  primera_cita: { ocasiones: ['romántico', 'noche'], descriptores: ['elegante', 'cálido'], intensidad: 3 },
  boda: { ocasiones: ['formal', 'noche'], descriptores: ['elegante', 'sofisticado'], intensidad: 3 },
  entrevista: { ocasiones: ['trabajo', 'formal'], descriptores: ['limpio', 'discreto'], intensidad: 2 },
  playa: { ocasiones: ['verano', 'diario'], descriptores: ['fresco', 'cítrico'], intensidad: 2 },
  negocios: { ocasiones: ['trabajo', 'formal'], descriptores: ['elegante', 'discreto'], intensidad: 2 },
  noche_verano: { ocasiones: ['noche', 'verano'], descriptores: ['fresco', 'dulce'], intensidad: 3 },
  cena: { ocasiones: ['romántico', 'noche'], descriptores: ['cálido', 'sensual'], intensidad: 4 },
  familiar: { ocasiones: ['diario', 'casual'], descriptores: ['suave', 'agradable'], intensidad: 2 },
  festival: { ocasiones: ['noche', 'casual'], descriptores: ['dulce', 'intenso'], intensidad: 4 },
  gym: { ocasiones: ['deporte', 'diario'], descriptores: ['fresco', 'limpio'], intensidad: 1 },
  trabajo_diario: { ocasiones: ['trabajo', 'diario'], descriptores: ['limpio', 'versátil'], intensidad: 2 },
  noche_invierno: { ocasiones: ['noche', 'invierno'], descriptores: ['cálido', 'especiado'], intensidad: 4 },
};

const CLIMA_DESCRIPTOR = {
  muy_calido: ['fresco', 'cítrico'],
  templado: ['versátil'],
  frio: ['cálido', 'especiado'],
  variable: ['versátil'],
};

// Modo D: personalidad → descriptores.
const PERSONALIDAD_DESCRIPTOR = {
  'Clásica': ['elegante', 'clásico'],
  Moderna: ['moderno', 'limpio'],
  Aventurera: ['intenso', 'distintivo'],
  'Romántica': ['dulce', 'floral'],
  Minimalista: ['limpio', 'discreto'],
  Extravagante: ['intenso', 'distintivo'],
  Deportiva: ['fresco', 'limpio'],
  Sofisticada: ['elegante', 'sofisticado'],
  Descontracturada: ['fresco', 'versátil'],
};

// Género probable por destinatario (cuando el modo D no lo pregunta).
const DESTINATARIO_GENERO = {
  mama: 'F', papa: 'M', amiga: 'F', amigo: 'M',
  hermana: 'F', hermano: 'M', abuela: 'F', abuelo: 'M',
  pareja: null, jefe: null,
};

function extraerKeywords(texto = '') {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-zñ]+/)
    .filter((p) => p.length > 3);
}

/**
 * payload: { modo, ...respuestas } tal cual lo arma el wizard.
 * referencia: doc completo del perfume de referencia (modos A/B) o null.
 */
function construirPerfil(payload, referencia) {
  const perfil = {
    referencia: referencia || null,
    familiaObjetivo: referencia?.familia_principal || null,
    familiasSecundariasObjetivo: referencia?.familias_secundarias || [],
    descriptoresObjetivo: [],
    ocasionesObjetivo: [],
    intensidadDeseada: null,
    pesoSimilitud: null,
    keywordsExtra: [],
  };

  if (payload.modo === 'A') {
    for (const chip of payload.que_gusto || []) {
      const d = CHIP_A_DESCRIPTOR[chip];
      if (d) perfil.descriptoresObjetivo.push(d);
    }
    for (const ctx of payload.contextos || []) {
      const o = CONTEXTO_A_OCASION[ctx];
      if (o) perfil.ocasionesObjetivo.push(o);
    }
    perfil.intensidadDeseada = payload.ajustes?.intensidad ?? null;
    // similitud 1 (muy parecido) → peso 1; 5 (diferente pero afín) → 0
    if (payload.ajustes?.similitud != null) {
      perfil.pesoSimilitud = (5 - payload.ajustes.similitud) / 4;
    }
  }

  if (payload.modo === 'B') {
    perfil.keywordsExtra = extraerKeywords(payload.descripcion);
    // fidelidad 1 (clon exacto) → peso 1; 5 (inspirado) → 0
    if (payload.ajustes?.fidelidad != null) {
      perfil.pesoSimilitud = (5 - payload.ajustes.fidelidad) / 4;
    }
  }

  if (payload.modo === 'C') {
    const base = OCASION_PERFIL[payload.ocasion] || {};
    perfil.ocasionesObjetivo = base.ocasiones || [];
    perfil.descriptoresObjetivo = [
      ...(base.descriptores || []),
      ...(CLIMA_DESCRIPTOR[payload.clima] || []),
    ];
    perfil.intensidadDeseada = base.intensidad ?? null;
  }

  if (payload.modo === 'D') {
    for (const p of payload.personalidad || []) {
      perfil.descriptoresObjetivo.push(...(PERSONALIDAD_DESCRIPTOR[p] || []));
    }
    perfil.keywordsExtra = extraerKeywords(payload.perfume_mencionado);
    // Edad orienta la intensidad: más juventud, más impacto.
    const edad = payload.edad?.edad;
    if (edad != null) perfil.intensidadDeseada = edad < 25 ? 4 : edad < 45 ? 3 : 2;
  }

  perfil.descriptoresObjetivo = [...new Set(perfil.descriptoresObjetivo)];
  perfil.ocasionesObjetivo = [...new Set(perfil.ocasionesObjetivo)];
  return perfil;
}

function generoObjetivo(payload) {
  if (payload.modo === 'C') return payload.genero || null;
  if (payload.modo === 'D') return DESTINATARIO_GENERO[payload.destinatario] ?? null;
  return null;
}

function precioObjetivo(payload) {
  const rango =
    payload.presupuesto?.rango || payload.ajustes?.precio || null;
  if (!rango || rango === 'Sin filtro') return null;
  const mapa = {
    Accesible: 'accesible', Medio: 'medio', Premium: 'premium', Nicho: 'nicho',
  };
  return mapa[rango] || null;
}

module.exports = { construirPerfil, generoObjetivo, precioObjetivo, extraerKeywords };
