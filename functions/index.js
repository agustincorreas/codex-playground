const admin = require('firebase-admin');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const { construirPerfil, generoObjetivo, precioObjetivo } = require('./src/matching/perfil');
const { obtenerCandidatos } = require('./src/matching/candidatos');
const { rankear, interseccion } = require('./src/matching/engine');
const { verificarLimite, resetearContadores } = require('./src/rateLimit');
const { enriquecerRecomendacion, turnoChat } = require('./src/premium/sommelier');

admin.initializeApp();

const REGION = 'southamerica-east1';

// El estado PRO se persiste en usuarios/{uid}.pro vía webhook de RevenueCat.
async function usuarioEsPro(uid) {
  if (!uid) return false;
  const doc = await admin.firestore().collection('usuarios').doc(uid).get();
  return doc.exists && doc.data().pro === true;
}

// ---------------------------------------------------------------------------
// 1. MOTOR DE MATCHING (tier gratuito, sin IA)
// ---------------------------------------------------------------------------
exports.recomendar = onCall({ region: REGION }, async (request) => {
  const payload = request.data || {};
  const uid = request.auth?.uid || null;
  const esPro = await usuarioEsPro(uid);

  await verificarLimite(uid || payload.deviceId, !uid, esPro, payload.modo);

  // Perfume de referencia (modos A y B) si se eligió de la base.
  let referencia = null;
  if (payload.perfume_referencia?.id) {
    const doc = await admin
      .firestore()
      .collection('perfumes')
      .doc(payload.perfume_referencia.id)
      .get();
    if (doc.exists) referencia = { id: doc.id, ...doc.data() };
  }

  const perfil = construirPerfil(payload, referencia);

  const candidatos = await obtenerCandidatos({
    genero: generoObjetivo(payload),
    precioRango: precioObjetivo(payload),
    soloDisponibles: payload.modo === 'B', // reemplazo: discontinuado = false
    familiaObjetivo: perfil.familiaObjetivo,
    exclusiones: payload.exclusiones || '',
    excluirId: referencia?.id || null,
  });

  // Keywords del texto libre (modo B y "perfume mencionado" en D) suman
  // descriptores objetivo si matchean el vocabulario de la base.
  if (perfil.keywordsExtra.length > 0) {
    perfil.descriptoresObjetivo = [
      ...new Set([...perfil.descriptoresObjetivo, ...perfil.keywordsExtra]),
    ];
  }

  const top = rankear(perfil, candidatos, 5);

  // Persistimos la búsqueda para historial y para el enriquecimiento
  // premium (que corre como llamada separada).
  const busquedaRef = admin.firestore().collection('busquedas').doc();
  await busquedaRef.set({
    uid,
    deviceId: payload.deviceId || null,
    input: sanitizarInput(payload),
    resultados: top,
    creado_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (uid) {
    await admin
      .firestore()
      .collection('usuarios')
      .doc(uid)
      .collection('historial')
      .doc(busquedaRef.id)
      .set({
        input: sanitizarInput(payload),
        resultados: top,
        creado_at: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  return { resultados: top, busquedaId: busquedaRef.id };
});

function sanitizarInput(payload) {
  const { deviceId, ...resto } = payload;
  return resto;
}

// ---------------------------------------------------------------------------
// 2. ENRIQUECIMIENTO PREMIUM (GPT-4o)
// ---------------------------------------------------------------------------
exports.enriquecerPremium = onCall(
  { region: REGION, secrets: ['OPENAI_API_KEY'], timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitás una cuenta.');
    if (!(await usuarioEsPro(uid))) {
      throw new HttpsError('permission-denied', 'Función exclusiva de la membresía PRO.');
    }

    const { busquedaId } = request.data || {};
    const busquedaDoc = await admin.firestore().collection('busquedas').doc(busquedaId).get();
    if (!busquedaDoc.exists) throw new HttpsError('not-found', 'Búsqueda inexistente.');
    const busqueda = busquedaDoc.data();
    if (busqueda.uid && busqueda.uid !== uid) {
      throw new HttpsError('permission-denied', 'La búsqueda no te pertenece.');
    }

    // Si ya se enriqueció (reapertura desde historial), no se vuelve a llamar a la IA.
    if (busqueda.enriquecidos) return busqueda.enriquecidos;

    let referencia = null;
    if (busqueda.input?.perfume_referencia?.id) {
      const doc = await admin
        .firestore()
        .collection('perfumes')
        .doc(busqueda.input.perfume_referencia.id)
        .get();
      if (doc.exists) referencia = { id: doc.id, ...doc.data() };
    }

    const enriquecidos = {};
    await Promise.all(
      (busqueda.resultados || []).map(async (perfume) => {
        try {
          enriquecidos[perfume.id] = await enriquecerRecomendacion({
            perfume,
            input: busqueda.input,
            referencia,
          });
        } catch (e) {
          console.error(`Enriquecimiento falló para ${perfume.id}:`, e.message);
        }
      })
    );

    // Se guardan las explicaciones generadas en la búsqueda y el historial.
    await busquedaDoc.ref.update({ enriquecidos });
    if (busqueda.uid) {
      await admin
        .firestore()
        .collection('usuarios')
        .doc(busqueda.uid)
        .collection('historial')
        .doc(busquedaId)
        .set({ enriquecidos }, { merge: true });
    }

    return enriquecidos;
  }
);

// ---------------------------------------------------------------------------
// 3. CHAT SOMMELIER (premium)
// ---------------------------------------------------------------------------
exports.chatSommelier = onCall(
  { region: REGION, secrets: ['OPENAI_API_KEY'], timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitás una cuenta.');
    if (!(await usuarioEsPro(uid))) {
      throw new HttpsError('permission-denied', 'Función exclusiva de la membresía PRO.');
    }

    const { busquedaId, mensajes } = request.data || {};
    if (!Array.isArray(mensajes) || mensajes.length === 0) {
      throw new HttpsError('invalid-argument', 'Faltan mensajes.');
    }

    let contexto = { input: null, resultados: [] };
    if (busquedaId) {
      const doc = await admin.firestore().collection('busquedas').doc(busquedaId).get();
      if (doc.exists) contexto = doc.data();
    }

    const respuesta = await turnoChat(contexto, mensajes);
    return { respuesta };
  }
);

// ---------------------------------------------------------------------------
// 4. RESET DE CONTADORES — medianoche UTC-3 (03:00 UTC)
// ---------------------------------------------------------------------------
exports.resetearContadoresDiarios = onSchedule(
  { region: REGION, schedule: '0 3 * * *', timeZone: 'Etc/UTC' },
  async () => {
    const borrados = await resetearContadores();
    console.log(`Contadores diarios reseteados: ${borrados} documentos.`);
  }
);

// ---------------------------------------------------------------------------
// 5. WEBHOOK DE REVENUECAT — sincroniza el entitlement "pro" a Firestore
// ---------------------------------------------------------------------------
exports.revenuecatWebhook = onRequest(
  { region: REGION, secrets: ['REVENUECAT_WEBHOOK_AUTH'] },
  async (req, res) => {
    if (req.headers.authorization !== `Bearer ${process.env.REVENUECAT_WEBHOOK_AUTH}`) {
      res.status(401).send('No autorizado');
      return;
    }
    const evento = req.body?.event;
    const uid = evento?.app_user_id;
    if (!uid) {
      res.status(400).send('Evento inválido');
      return;
    }
    const activos = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'];
    const inactivos = ['EXPIRATION', 'CANCELLATION'];
    let pro = null;
    if (activos.includes(evento.type)) pro = true;
    if (inactivos.includes(evento.type)) pro = evento.type === 'CANCELLATION' ? null : false;
    if (pro !== null) {
      await admin
        .firestore()
        .collection('usuarios')
        .doc(uid)
        .set({ pro, pro_actualizado_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    res.status(200).send('ok');
  }
);
