import {
  collection, doc, setDoc, getDocs, query, orderBy, limit,
  serverTimestamp, deleteDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// usuarios/{uid}/historial — resumen del input + resultados.
// Las explicaciones premium se guardan ya generadas para no
// volver a llamar a la IA al reabrir la búsqueda.

export async function guardarBusqueda(uid, busquedaId, { input, resultados, enriquecidos }) {
  const ref = doc(db, 'usuarios', uid, 'historial', busquedaId);
  await setDoc(
    ref,
    {
      input,
      resultados,
      enriquecidos: enriquecidos || null,
      creado_at: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function listarHistorial(uid, max = 50) {
  const ref = collection(db, 'usuarios', uid, 'historial');
  const snap = await getDocs(query(ref, orderBy('creado_at', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function borrarBusqueda(uid, busquedaId) {
  await deleteDoc(doc(db, 'usuarios', uid, 'historial', busquedaId));
}
