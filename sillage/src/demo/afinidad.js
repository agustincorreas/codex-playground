// Mapa de afinidad entre familias olfativas (hardcodeado por diseño).
// Una familia "adyacente" suma 10 puntos en la dimensión familia.
const AFINIDAD = {
  Oriental: ['Amaderado', 'Gourmand', 'Especiado'],
  Amaderado: ['Oriental', 'Musguoso', 'Fougère'],
  Floral: ['Cítrico', 'Acuático', 'Amaderado'],
  'Fougère': ['Amaderado', 'Especiado', 'Aromático'],
  Chypre: ['Musguoso', 'Cuero', 'Floral'],
  'Cítrico': ['Acuático', 'Floral', 'Aromático'],
  'Acuático': ['Cítrico', 'Fougère', 'Aromático'],
  Gourmand: ['Oriental', 'Floral', 'Amaderado'],
  Cuero: ['Chypre', 'Oriental', 'Especiado'],
  'Aromático': ['Fougère', 'Cítrico', 'Acuático'],
};

function sonAdyacentes(familiaA, familiaB) {
  if (!familiaA || !familiaB) return false;
  return (
    (AFINIDAD[familiaA] || []).includes(familiaB) ||
    (AFINIDAD[familiaB] || []).includes(familiaA)
  );
}

module.exports = { AFINIDAD, sonAdyacentes };
