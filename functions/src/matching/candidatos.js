const admin = require('firebase-admin');
const { extraerKeywords } = require('./perfil');

const MAX_CANDIDATOS = 200;

// FILTROS DUROS antes del scoring. La base nunca se carga entera en
// memoria: los filtros van en la query de Firestore y el set resultante
// (máx 200 docs) se rankea en memoria.
async function obtenerCandidatos({
  genero,            // 'M' | 'F' | 'U' | null
  precioRango,       // 'accesible' | 'medio' | 'premium' | 'nicho' | null
  soloDisponibles,   // true en modo B (reemplazo de discontinuado)
  familiaObjetivo,   // prioriza candidatos de la misma familia si existe
  exclusiones,       // texto libre del usuario
  excluirId,         // id del perfume de referencia
}) {
  const db = admin.firestore();
  let q = db.collection('perfumes');

  if (genero && genero !== 'U') {
    // Un perfume unisex siempre es candidato válido.
    q = q.where('genero', 'in', [genero, 'U']);
  }
  if (precioRango) q = q.where('precio_rango', '==', precioRango);
  if (soloDisponibles) q = q.where('discontinuado', '==', false);

  let candidatos = [];

  if (familiaObjetivo) {
    // Dos queries: misma familia (mitad del cupo) + resto por popularidad.
    const mitad = Math.floor(MAX_CANDIDATOS / 2);
    const [familiares, generales] = await Promise.all([
      q.where('familia_principal', '==', familiaObjetivo)
        .orderBy('popularidad_score', 'desc')
        .limit(mitad)
        .get(),
      q.orderBy('popularidad_score', 'desc').limit(MAX_CANDIDATOS).get(),
    ]);
    const vistos = new Set();
    for (const snap of [familiares, generales]) {
      for (const doc of snap.docs) {
        if (vistos.has(doc.id) || candidatos.length >= MAX_CANDIDATOS) continue;
        vistos.add(doc.id);
        candidatos.push({ id: doc.id, ...doc.data() });
      }
    }
  } else {
    const snap = await q
      .orderBy('popularidad_score', 'desc')
      .limit(MAX_CANDIDATOS)
      .get();
    candidatos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (excluirId) candidatos = candidatos.filter((c) => c.id !== excluirId);

  // Exclusiones de texto libre: keywords contra notas y descriptores.
  const keywords = extraerKeywords(exclusiones || '');
  if (keywords.length > 0) {
    candidatos = candidatos.filter((c) => {
      const corpus = [
        ...(c.notas_salida || []),
        ...(c.notas_corazon || []),
        ...(c.notas_fondo || []),
        ...(c.descriptores || []),
        c.nombre,
        c.marca,
      ]
        .join(' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return !keywords.some((k) => corpus.includes(k));
    });
  }

  return candidatos;
}

module.exports = { obtenerCandidatos, MAX_CANDIDATOS };
