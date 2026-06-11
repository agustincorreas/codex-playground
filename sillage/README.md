# Sillage — Recomendador de perfumes

App móvil (iOS y Android) de recomendación de perfumes para el mercado
hispanohablante, con dos capas de experiencia:

- **Tier gratuito**: motor de recomendación propio por matching de atributos
  (notas, familia olfativa, pirámide, ocasión, intensidad). Sin IA generativa,
  sostenible desde el día cero.
- **Tier premium (PRO)**: las mismas recomendaciones enriquecidas con
  explicaciones de GPT-4o, chat conversacional con el sommelier y acceso
  ilimitado a todos los modos.

## Stack

| Capa | Tecnología |
|---|---|
| App | React Native (Expo managed) + React Navigation v6 |
| Estado | Zustand |
| Backend | Firebase: Firestore, Auth, Cloud Functions, Cloud Scheduler |
| IA (premium) | OpenAI GPT-4o vía Cloud Function |
| Pagos | RevenueCat (suscripciones App Store / Play Store) |
| Animaciones | Reanimated |
| Base de datos | Scripts Python externos (ver `../sillage-db-tools/`) |

## Estructura del monorepo

```
sillage/             App Expo (este directorio)
functions/           Cloud Functions (matching, premium, rate limit, webhook)
sillage-db-tools/    Scripts de scraping/normalización/carga (repo separado)
firebase.json        Config de deploy
firestore.rules      Reglas de seguridad
firestore.indexes.json  Índices compuestos
```

## Setup

### 1. Firebase

1. Creá un proyecto en [console.firebase.google.com](https://console.firebase.google.com).
2. Habilitá **Firestore**, **Authentication** (Google y Apple) y **Functions**
   (requiere plan Blaze).
3. Registrá las apps iOS y Android y copiá la configuración web al `.env`.
4. Desplegá reglas, índices y funciones desde la raíz del monorepo:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && cd ..
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH
firebase deploy --only functions
```

### 2. Base de perfumes

Seguí el README de `../sillage-db-tools/` para scrapear, normalizar y cargar
el catálogo inicial (~3.000 perfumes) en la colección `perfumes`.

### 3. RevenueCat

1. Creá el proyecto en RevenueCat y conectá App Store Connect y Google Play.
2. Productos: `sillage_pro_mensual` y `sillage_pro_anual`, ambos adjuntos al
   entitlement **`pro`** y a la offering default (paquetes `$rc_monthly` y
   `$rc_annual`).
3. Configurá el webhook de RevenueCat apuntando a la función
   `revenuecatWebhook` con header `Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>`.
   El webhook sincroniza el entitlement a `usuarios/{uid}.pro`, que es lo que
   validan las funciones premium del backend.

### 4. App

```bash
cd sillage
cp .env.example .env   # completar credenciales
npm install
npx expo prebuild      # react-native-fast-image y purchases requieren dev client
npx expo run:ios       # o run:android
```

> `react-native-fast-image` y `react-native-purchases` tienen código nativo:
> la app no corre en Expo Go, usá un development build (`expo run:*` o EAS).

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `EXPO_PUBLIC_FIREBASE_*` | app `.env` | Credenciales Firebase (6 campos) |
| `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS/ANDROID` | app `.env` | Claves públicas de RevenueCat |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*` | app `.env` | OAuth de Google Sign-In |
| `OPENAI_API_KEY` | secret de Functions | GPT-4o (solo premium) |
| `REVENUECAT_WEBHOOK_AUTH` | secret de Functions | Token del webhook |
| `GOOGLE_APPLICATION_CREDENTIALS` | scripts Python | Service account de Firestore |
| `FRAGRANTICA_BASE_URL` | scripts Python | Override de la URL base del scraper |

## Arquitectura de la recomendación

1. El wizard (4 modos: amé un perfume / discontinuado / ocasión / regalo)
   arma un payload declarativo (`src/wizard/config.js`).
2. La Cloud Function `recomendar` aplica **filtros duros** vía queries de
   Firestore (género, precio, discontinuado — máx. 200 candidatos), construye
   el perfil objetivo y rankea en memoria con el scoring 0-100:
   notas (35) + familia (25, con mapa de afinidad) + descriptores (20) +
   ocasión (10) + intensidad (5) + popularidad (5).
3. Devuelve el top 5 con desglose por dimensión. El desglose y el score
   numérico solo se muestran en PRO.
4. Si el usuario es PRO, `enriquecerPremium` llama a GPT-4o por cada perfume
   y persiste las explicaciones en la búsqueda y el historial (no se vuelve a
   generar al reabrir).

## Rate limiting

| Tier | Límite |
|---|---|
| Gratuito con cuenta | 10 búsquedas/día (modos C y D: 5/día) |
| Guest (device ID) | 3 búsquedas/día |
| PRO | Ilimitado |

Contadores diarios en la colección `limites`, reseteados por Cloud Scheduler
a medianoche UTC-3 (`resetearContadoresDiarios`).
