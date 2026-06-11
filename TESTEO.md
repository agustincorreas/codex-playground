# Cómo probar Sillage sin crear ninguna cuenta

La app incluye un **modo demo** que se activa solo cuando no hay credenciales
configuradas. Funciona 100% en tu teléfono, sin Firebase ni internet (salvo
para las imágenes): usa la base de muestra de 31 perfumes y el motor de
recomendación corriendo localmente.

## Qué vas a poder probar

- Los 4 modos del formulario completos (similar / discontinuado / ocasión / regalo)
- Recomendaciones reales calculadas con el motor de matching
- Guardar perfumes e historial (se guardan en el teléfono)
- El botón "Ver dónde comprar" (abre MercadoLibre)
- La experiencia PRO con textos de muestra: en la pantalla de upgrade
  tocá **"Probar PRO (demo)"**

Lo único que no hace el demo: cuentas reales, pagos reales y textos del
sommelelier generados por IA (muestra textos de ejemplo en su lugar).

## Pasos (una sola vez, ~15 minutos)

### En tu computadora

1. **Instalá Node.js**: bajalo de https://nodejs.org (botón verde "LTS"),
   instalalo con todo por defecto.
2. **Bajá el código**: en https://github.com/agustincorreas/codex-playground
   tocá el botón verde **Code → Download ZIP** y descomprimilo
   (o `git clone` si ya usás git).
3. **Abrí una terminal** en la carpeta descomprimida:
   - Windows: en el Explorador, dentro de la carpeta, click derecho →
     "Abrir en Terminal".
   - Mac: arrastrá la carpeta al ícono de Terminal.
4. Ejecutá estos comandos (uno por uno):

```bash
cd sillage
npm install
npx expo start
```

Va a aparecer un **código QR** en la terminal.

### En tu teléfono

5. Instalá la app **Expo Go** (gratis, está en App Store y Google Play).
6. Conectá el teléfono al **mismo Wi-Fi** que la computadora.
7. Escaneá el QR:
   - Android: desde la propia app Expo Go.
   - iPhone: con la cámara, y tocá el aviso que aparece.

La app se carga en unos segundos y vas a ver el banner "Modo demo" arriba.

## Si algo falla

- El proyecto está fijado a **Expo SDK 54**, la versión que soporta la app
  Expo Go actual. Si más adelante Expo Go se actualiza a un SDK más nuevo y
  aparece "Project is incompatible with this version of Expo Go", hay que
  actualizar el proyecto al SDK nuevo (pedíselo a tu asistente o seguí
  https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).
- **El QR no conecta**: probá `npx expo start --tunnel` (instala una
  dependencia y funciona aunque el Wi-Fi bloquee conexiones locales).
- **Alternativa sin teléfono**: `npx expo start --web` abre la app en el
  navegador de la computadora (la experiencia visual es aproximada, pero
  sirve para probar el flujo).

## Después del testeo

Cuando la app te convenza, el camino a producción está en `PRODUCCION.md`:
con el Paso 1 (Firebase) el mismo código pasa automáticamente del modo demo
al modo conectado — no hay que cambiar nada, solo completar el archivo `.env`.
