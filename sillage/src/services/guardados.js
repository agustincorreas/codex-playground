import {
  collection, doc, setDoc, getDocs, deleteDoc, query, orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { DEMO } from '../config/demo';

// usuarios/{uid}/guardados — perfumes marcados desde cualquier búsqueda.
// En modo demo se persisten en AsyncStorage (sin cuenta).

const CLAVE_DEMO = 'sillage_demo_guardados';

async function leerDemo() {
  const crudo = await AsyncStorage.getItem(CLAVE_DEMO);
  return crudo ? JSON.parse(crudo) : [];
}

export async function guardarPerfume(uid, perfume) {
  const datos = {
    perfume_id: perfume.id,
    nombre: perfume.nombre,
    marca: perfume.marca,
    imagen_url: perfume.imagen_url || null,
    familia_principal: perfume.familia_principal || null,
    concentracion: perfume.concentracion || null,
  };

  if (DEMO) {
    const lista = await leerDemo();
    const sinDuplicado = lista.filter((p) => p.id !== perfume.id);
    sinDuplicado.unshift({ id: perfume.id, ...datos, guardado_at: Date.now() });
    await AsyncStorage.setItem(CLAVE_DEMO, JSON.stringify(sinDuplicado));
    return;
  }

  const ref = doc(db, 'usuarios', uid, 'guardados', perfume.id);
  await setDoc(ref, { ...datos, guardado_at: serverTimestamp() });
}

export async function quitarGuardado(uid, perfumeId) {
  if (DEMO) {
    const lista = await leerDemo();
    await AsyncStorage.setItem(
      CLAVE_DEMO,
      JSON.stringify(lista.filter((p) => p.id !== perfumeId))
    );
    return;
  }
  await deleteDoc(doc(db, 'usuarios', uid, 'guardados', perfumeId));
}

export async function listarGuardados(uid) {
  if (DEMO) return leerDemo();
  const ref = collection(db, 'usuarios', uid, 'guardados');
  const snap = await getDocs(query(ref, orderBy('guardado_at', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
