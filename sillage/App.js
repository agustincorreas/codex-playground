import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import RootNavigator from './src/navigation/RootNavigator';
import { auth } from './src/config/firebase';
import { initRevenueCat, esPro } from './src/config/revenuecat';
import { useUserStore } from './src/store/useUserStore';

export default function App() {
  const { setUser, setPro, setDeviceId } = useUserStore();

  useEffect(() => {
    // Device ID persistente para el rate limit de guests (3 búsquedas/día).
    (async () => {
      let deviceId = await AsyncStorage.getItem('sillage_device_id');
      if (!deviceId) {
        deviceId = Crypto.randomUUID();
        await AsyncStorage.setItem('sillage_device_id', deviceId);
      }
      setDeviceId(deviceId);
    })();

    // Sesión de Firebase + estado de suscripción en RevenueCat.
    const unsub = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      initRevenueCat(user?.uid);
      setPro(await esPro());
    });
    return unsub;
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <RootNavigator />
    </>
  );
}
