# Guía de salida a producción — Sillage

Checklist ordenado para pasar del código (ya completo en este repo) a la app
publicada en App Store y Google Play. Cada paso indica qué cuenta hace falta,
cuánto cuesta y qué hay que copiar de vuelta al proyecto.

> El código no necesita cambios para nada de esto: solo se completan
> credenciales en archivos de configuración.

---

## Paso 1 — Firebase (backend) · gratis para empezar

1. Entrá a https://console.firebase.google.com con una cuenta de Google
   y creá un proyecto (ej: `sillage-prod`).
2. Activá **Firestore** (modo producción, región `southamerica-east1`).
3. Activá **Authentication** → métodos Google y Apple.
4. Pasá el proyecto al plan **Blaze** (requiere tarjeta; las Cloud Functions
   lo exigen, pero el uso inicial entra en la capa gratuita).
5. En *Configuración del proyecto → Tus apps*, registrá una app **Web** y
   copiá los 6 valores (`apiKey`, `authDomain`, etc.) a `sillage/.env`
   (usá `sillage/.env.example` como plantilla).
6. En *Cuentas de servicio*, generá una clave privada y guardala como
   `sillage-db-tools/serviceAccountKey.json` (NO subirla a git; ya está
   ignorada).

Después, desde la raíz del repo (necesita Node 20+):

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # elegir el proyecto creado
firebase deploy --only firestore:rules,firestore:indexes
```

## Paso 2 — Cargar la base de perfumes · gratis

Hay una base inicial de 31 perfumes populares en `sillage-db-tools/seed/`
para que la app funcione hoy mismo. Para cargarla:

```bash
cd sillage-db-tools
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
python normalizer.py --entrada seed/ --salida normalizado/
python uploader.py --entrada normalizado/
```

Para crecer hacia las ~3.000 fichas, seguí el README de `sillage-db-tools/`
(scraping o dataset público de Kaggle con `dataset_adapter.py`).

## Paso 3 — OpenAI (capa premium) · pago por uso

1. Creá una cuenta en https://platform.openai.com y generá una API key.
2. Cargá crédito (USD 10 alcanza de sobra para arrancar; cada
   enriquecimiento de 5 perfumes cuesta centavos).
3. Guardala como secret de Functions:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH   # inventá un token largo
cd functions && npm install && cd ..
firebase deploy --only functions
```

## Paso 4 — Cuentas de desarrollador de las tiendas

| Tienda | Cuenta | Costo |
|---|---|---|
| App Store (iOS) | https://developer.apple.com | USD 99/año |
| Google Play (Android) | https://play.google.com/console | USD 25 una sola vez |

La aprobación de Apple puede tardar 1-2 días; la primera revisión de Google
hasta una semana.

## Paso 5 — RevenueCat (suscripciones) · gratis hasta USD 2.500/mes de ingresos

1. Creá cuenta en https://www.revenuecat.com y un proyecto "Sillage".
2. Creá las suscripciones en App Store Connect y Play Console:
   `sillage_pro_mensual` y `sillage_pro_anual`.
3. En RevenueCat: entitlement **`pro`**, offering default con paquetes
   `$rc_monthly` y `$rc_annual` apuntando a esos productos.
4. Copiá las claves públicas iOS/Android a `sillage/.env`.
5. En *Integrations → Webhooks*, apuntá a la URL de la función
   `revenuecatWebhook` (aparece tras el deploy del paso 3) con el header
   `Authorization: Bearer <el token que inventaste>`.

## Paso 6 — Google/Apple Sign-In

1. Google: en https://console.cloud.google.com (mismo proyecto de Firebase),
   creá OAuth client IDs iOS, Android y Web → copiarlos a `sillage/.env`.
2. Apple: en el portal de Apple Developer, habilitá *Sign in with Apple*
   para el bundle `com.sillage.app` (Firebase Auth lo guía).

## Paso 7 — Build y publicación con EAS

```bash
cd sillage
npm install
npm install -g eas-cli
eas login                # cuenta gratuita de Expo
eas build:configure      # vincula el projectId en app.json
eas build --profile production --platform all
eas submit --platform ios
eas submit --platform android
```

Para probar antes de publicar: `eas build --profile preview` genera un APK
instalable directo y un build de iOS para TestFlight.

---

## Resumen de costos fijos

- Apple Developer: USD 99/año (obligatorio para iOS)
- Google Play: USD 25 única vez
- Firebase, RevenueCat, Expo EAS: gratis en el nivel inicial
- OpenAI: pago por uso, solo lo consumen los usuarios PRO

## Orden recomendado si querés ir de a poco

1. Pasos 1-2 → la app ya funciona en modo desarrollo con datos reales.
2. Paso 3 → se habilita la capa premium.
3. Pasos 4-7 → publicación en tiendas.
