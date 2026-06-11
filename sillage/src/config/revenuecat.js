import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

export const ENTITLEMENT_PRO = 'pro';

export function initRevenueCat(appUserId) {
  const apiKey = Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS,
    android: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID,
  });
  if (!apiKey) return;
  Purchases.configure({ apiKey, appUserID: appUserId || null });
}

export async function esPro() {
  try {
    const info = await Purchases.getCustomerInfo();
    return Boolean(info.entitlements.active[ENTITLEMENT_PRO]);
  } catch {
    return false;
  }
}

export async function obtenerOfertas() {
  const offerings = await Purchases.getOfferings();
  return offerings.current; // packages: $rc_monthly y $rc_annual
}

export async function comprar(pkg) {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT_PRO]);
}

export async function restaurar() {
  const info = await Purchases.restorePurchases();
  return Boolean(info.entitlements.active[ENTITLEMENT_PRO]);
}
