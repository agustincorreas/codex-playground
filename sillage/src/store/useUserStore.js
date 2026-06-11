import { create } from 'zustand';

// Estado global del usuario: sesión, tier y región de compra.
export const useUserStore = create((set) => ({
  user: null,            // objeto de Firebase Auth o null (guest)
  isPro: false,          // entitlement activo en RevenueCat
  region: 'AR',          // AR | CL | MX — define el sitio de MercadoLibre
  moneda: 'ARS',
  deviceId: null,        // para rate limit de guests

  setUser: (user) => set({ user }),
  setPro: (isPro) => set({ isPro }),
  setRegion: (region, moneda) => set({ region, moneda }),
  setDeviceId: (deviceId) => set({ deviceId }),
  logout: () => set({ user: null, isPro: false }),
}));
