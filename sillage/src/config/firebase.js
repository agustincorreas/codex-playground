import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO } from './demo';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// En modo demo (sin credenciales) no se inicializa Firebase: los
// servicios usan la base local y AsyncStorage.
export const app = DEMO ? null : initializeApp(firebaseConfig);
export const db = DEMO ? null : getFirestore(app);
export const auth = DEMO
  ? null
  : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
export const functions = DEMO
  ? null
  : getFunctions(app, process.env.EXPO_PUBLIC_FUNCTIONS_REGION || 'southamerica-east1');
