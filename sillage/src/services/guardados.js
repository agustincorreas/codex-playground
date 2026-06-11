import {
  collection, doc, setDoc, getDocs, deleteDoc, query, orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// usuarios/{uid}/guardados — perfumes marcados desde cualquier búsqueda.

export async function guardarPerfume(uid, perfume) {
  const ref = doc(db, 'usuarios', uid, 'guardados', perfume.id);
  await setDoc(ref, {
    perfume_id: perfume.id,
    nombre: perfume.nombre,
    marca: perfume.marca,
    imagen_url: perfume.imagen_url || null,
    familia_principal: perfume.familia_principal || null,
    concentracion: perfume.concentracion || null,
    guardado_at: serverTimestamp(),
  });
}

export async function quitarGuardado(uid, perfumeId) {
  await deleteDoc(doc(db, 'usuarios', uid, 'guardados', perfumeId));
}

export async function listarGuardados(uid) {
  const ref = collection(db, 'usuarios', uid, 'guardados');
  const snap = await getDocs(query(ref, orderBy('guardado_at', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
