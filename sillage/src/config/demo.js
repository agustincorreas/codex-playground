// Modo demo: se activa automáticamente cuando no hay credenciales de
// Firebase configuradas. Toda la app funciona offline con la base de
// muestra (31 perfumes) y el motor de matching corriendo localmente.
export const DEMO = !process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
