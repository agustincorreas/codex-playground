import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  GoogleAuthProvider, OAuthProvider, signInWithCredential,
} from 'firebase/auth';
import * as Google from 'expo-auth-session/providers/google';
import { auth } from '../config/firebase';
import { useUserStore } from '../store/useUserStore';
import PrimaryButton from './PrimaryButton';
import { colors, radius, spacing, typography } from '../theme/tokens';

// Bottom sheet de registro. Aparece cuando un guest intenta guardar
// o acceder al historial.
export default function AuthSheet({ visible, onClose }) {
  const setUser = useUserStore((s) => s.setUser);

  const [, , promptGoogle] = Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB,
  });

  const conGoogle = async () => {
    const res = await promptGoogle();
    if (res?.type !== 'success') return;
    const credential = GoogleAuthProvider.credential(res.params.id_token);
    const { user } = await signInWithCredential(auth, credential);
    setUser(user);
    onClose();
  };

  const conApple = async () => {
    const apple = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: apple.identityToken });
    const { user } = await signInWithCredential(auth, credential);
    setUser(user);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.fondo} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.manija} />
        <Text style={styles.titulo}>Guardá tus descubrimientos</Text>
        <Text style={styles.subtitulo}>
          Creá tu cuenta para guardar perfumes y acceder a tu historial de búsquedas
          desde cualquier dispositivo.
        </Text>
        <PrimaryButton label="Continuar con Google" onPress={conGoogle} />
        {Platform.OS === 'ios' && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={12}
            style={styles.apple}
            onPress={conApple}
          />
        )}
        <Pressable onPress={onClose}>
          <Text style={styles.despues}>Más tarde</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#00000099' },
  sheet: {
    backgroundColor: colors.superficie,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  manija: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.separador,
    alignSelf: 'center',
  },
  titulo: typography.titulo,
  subtitulo: typography.secundario,
  apple: { height: 50 },
  despues: { ...typography.secundario, textAlign: 'center', marginTop: spacing.sm },
});
