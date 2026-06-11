import {
  collection, doc, setDoc, getDocs, query, orderBy, limit,
  serverTimestamp, deleteDoc,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { DEMO } from '../config/demo';

// usuarios/{uid}/historial — resumen del input + resultados.
// Las explicaciones premium se guardan ya generadas para no
// volver a llamar a la IA.
// En modo demo el historial vive en AsyncStorage (máx. 20 búsquedas).

const CLAVE_DEMO = 'sillage_demo_historial';

async function leerDemo() {
  const crudo = await AsyncStorage.getItem(CLAVE_DEMO);
  return crudo ? JSON.parse(crudo) : [];
}

export async function guardarBusqueda(uid, busquedaId, { input, resultados, enriquecidos }) {
  if (DEMO) {
    const lista = await leerDemo();
    const sinDuplicado = lista.filter((b) => b.id !== busquedaId);
    sinDuplicado.unshift({
      id: busquedaId,
      input,
      resultados,
      enriquecidos: enriquecidos || null,
      creado_at: Date.now(),
    });
    await AsyncStorage.setItem(CLAVE_DEMO, JSON.stringify(sinDuplicado.slice(0, 20)));
    return;
  }

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
  if (DEMO) return leerDemo();
  const ref = collection(db, 'usuarios', uid, 'historial');
  const snap = await getDocs(query(ref, orderBy('creado_at', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function borrarBusqueda(uid, busquedaId) {
  if (DEMO) {
    const lista = await leerDemo();
    await AsyncStorage.setItem(
      CLAVE_DEMO,
      JSON.stringify(lista.filter((b) => b.id !== busquedaId))
    );
    return;
  }
  await deleteDoc(doc(db, 'usuarios', uid, 'historial', busquedaId));
}
