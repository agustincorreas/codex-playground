import { create } from 'zustand';

export const useResultsStore = create((set) => ({
  resultados: [],        // top 5 con score y desglose
  enriquecidos: {},      // { [perfumeId]: { explicacion, cuando_usarlo, por_que_reemplaza } }
  busquedaId: null,      // id del doc de historial
  cargando: false,
  error: null,

  setResultados: (resultados, busquedaId) =>
    set({ resultados, busquedaId, error: null }),
  setEnriquecidos: (enriquecidos) => set({ enriquecidos }),
  setCargando: (cargando) => set({ cargando }),
  setError: (error) => set({ error, cargando: false }),
  limpiar: () =>
    set({ resultados: [], enriquecidos: {}, busquedaId: null, cargando: false, error: null }),
}));
