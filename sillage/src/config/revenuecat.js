import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { DEMO } from './demo';

export const ENTITLEMENT_PRO = 'pro';

export function initRevenueCat(appUserId) {
  if (DEMO) return;
  const apiKey = Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS,
    android: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID,
  });
  if (!apiKey) return;
  try {
    Purchases.configure({ apiKey, appUserID: appUserId || null });
  } catch (e) {
    // Sin módulo nativo (Expo Go / web): la app sigue en tier gratuito.
    console.warn('RevenueCat no disponible:', e.message);
  }
}

export async function esPro() {
  if (DEMO) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return Boolean(info.entitlements.active[ENTITLEMENT_PRO]);
  } catch {
    return false;
  }
}

export async function obtenerOfertas() {
  if (DEMO) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current; // packages: $rc_monthly y $rc_annual
}

export async function comprar(pkg) {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT_PRO]);
}

export async function restaurar() {
  if (DEMO) return false;
  const info = await Purchases.restorePurchases();
  return Boolean(info.entitlements.active[ENTITLEMENT_PRO]);
}
