import {
  collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { DEMO } from '../config/demo';
import { buscarLocal } from '../demo/motorLocal';

// Autocompletado contra Firestore. Firestore no soporta búsqueda
// case-insensitive nativa, por eso cada documento guarda
// `nombre_lower` y `marca_lower` (los genera el uploader).
// En modo demo busca sobre la base de muestra local.
export async function buscarPerfumes(texto, { incluirDiscontinuados = true } = {}) {
  if (DEMO) return buscarLocal(texto, { incluirDiscontinuados });
  const q = texto.trim().toLowerCase();
  if (q.length < 3) return [];

  const ref = collection(db, 'perfumes');
  const porNombre = query(
    ref,
    where('nombre_lower', '>=', q),
    where('nombre_lower', '<=', q + '\uf8ff'),
    orderBy('nombre_lower'),
    limit(10)
  );
  const porMarca = query(
    ref,
    where('marca_lower', '>=', q),
    where('marca_lower', '<=', q + '\uf8ff'),
    orderBy('marca_lower'),
    limit(10)
  );

  const [snapNombre, snapMarca] = await Promise.all([
    getDocs(porNombre),
    getDocs(porMarca),
  ]);

  const vistos = new Set();
  const resultados = [];
  for (const snap of [snapNombre, snapMarca]) {
    snap.forEach((doc) => {
      if (vistos.has(doc.id)) return;
      const data = { id: doc.id, ...doc.data() };
      if (!incluirDiscontinuados && data.discontinuado) return;
      vistos.add(doc.id);
      resultados.push(data);
    });
  }
  return resultados
    .sort((a, b) => (b.popularidad_score || 0) - (a.popularidad_score || 0))
    .slice(0, 10);
}
