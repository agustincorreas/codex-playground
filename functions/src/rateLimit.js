const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

// Límites diarios:
//   - Gratuito con cuenta: 10 búsquedas/día
//   - Gratuito sin cuenta (guest): 3/día por device ID
//   - Modos C y D en gratuito: 5/día (sub-límite)
//   - Premium: ilimitado
// Contadores en colección `limites`, reseteados por Cloud Scheduler a
// medianoche UTC-3 (ver index.js).

const LIMITE_USUARIO = 10;
const LIMITE_GUEST = 3;
const LIMITE_MODOS_PREMIUM = 5; // modos C y D en tier gratuito

function fechaHoy() {
  // Día calendario en UTC-3 para que el corte coincida con el reset.
  const ahora = new Date(Date.now() - 3 * 3600 * 1000);
  return ahora.toISOString().slice(0, 10);
}

/**
 * Verifica e incrementa el contador diario. Lanza `resource-exhausted`
 * si el sujeto superó su límite.
 * @param {string} sujeto  uid del usuario o deviceId del guest
 * @param {boolean} esGuest
 * @param {boolean} esPro
 * @param {string} modo  'A' | 'B' | 'C' | 'D'
 */
async function verificarLimite(sujeto, esGuest, esPro, modo) {
  if (esPro) return;
  if (!sujeto) throw new HttpsError('invalid-argument', 'Falta identificador de usuario o dispositivo.');

  const db = admin.firestore();
  const ref = db.collection('limites').doc(`${fechaHoy()}_${sujeto}`);
  const limiteTotal = esGuest ? LIMITE_GUEST : LIMITE_USUARIO;
  const esModoLimitado = modo === 'C' || modo === 'D';

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { total: 0, modosCD: 0 };

    if (data.total >= limiteTotal) {
      throw new HttpsError('resource-exhausted', 'Límite diario de búsquedas alcanzado.');
    }
    if (esModoLimitado && data.modosCD >= LIMITE_MODOS_PREMIUM) {
      throw new HttpsError('resource-exhausted', 'Límite diario para este modo alcanzado.');
    }

    tx.set(ref, {
      total: data.total + 1,
      modosCD: data.modosCD + (esModoLimitado ? 1 : 0),
      fecha: fechaHoy(),
      actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

// Borra los contadores de días anteriores (la invoca el scheduler).
async function resetearContadores() {
  const db = admin.firestore();
  const hoy = fechaHoy();
  const viejos = await db.collection('limites').where('fecha', '<', hoy).get();
  let batch = db.batch();
  let n = 0;
  for (const doc of viejos.docs) {
    batch.delete(doc.ref);
    n += 1;
    if (n % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  return viejos.size;
}

module.exports = { verificarLimite, resetearContadores };
