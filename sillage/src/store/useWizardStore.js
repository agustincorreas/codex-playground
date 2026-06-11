import { create } from 'zustand';

// Estado del formulario guiado. `respuestas` se mapea 1:1 al payload
// que recibe la Cloud Function `recomendar`.
const estadoInicial = {
  modo: null,        // 'A' | 'B' | 'C' | 'D'
  pasoActual: 0,
  respuestas: {},
};

export const useWizardStore = create((set, get) => ({
  ...estadoInicial,

  iniciar: (modo) => set({ ...estadoInicial, modo }),

  responder: (clave, valor) =>
    set((s) => ({ respuestas: { ...s.respuestas, [clave]: valor } })),

  avanzar: () => set((s) => ({ pasoActual: s.pasoActual + 1 })),
  retroceder: () => set((s) => ({ pasoActual: Math.max(0, s.pasoActual - 1) })),

  // "Refinar": vuelve al paso 0 conservando las respuestas previas.
  refinar: () => set({ pasoActual: 0 }),

  reiniciar: () => set(estadoInicial),

  payload: () => {
    const { modo, respuestas } = get();
    return { modo, ...respuestas };
  },
}));
