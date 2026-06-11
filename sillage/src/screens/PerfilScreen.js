import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { signOut } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useUserStore } from '../store/useUserStore';
import AuthSheet from '../components/AuthSheet';
import PrimaryButton from '../components/PrimaryButton';
import ProBadge from '../components/ProBadge';
import Chip from '../components/Chip';
import { colors, radius, spacing, typography } from '../theme/tokens';

const REGIONES = [
  { id: 'AR', label: 'Argentina', moneda: 'ARS' },
  { id: 'CL', label: 'Chile', moneda: 'CLP' },
  { id: 'MX', label: 'México', moneda: 'MXN' },
];

export default function PerfilScreen({ navigation }) {
  const { user, isPro, region, setRegion, logout } = useUserStore();
  const [authVisible, setAuthVisible] = useState(false);

  const cerrarSesion = async () => {
    await signOut(auth);
    logout();
  };

  return (
    <ScrollView style={styles.pantalla} contentContainerStyle={styles.contenido}>
      <Text style={styles.titulo}>Perfil</Text>

      <View style={styles.card}>
        {user ? (
          <>
            <Text style={styles.nombre}>{user.displayName || user.email}</Text>
            <Text style={styles.email}>{user.email}</Text>
          </>
        ) : (
          <>
            <Text style={styles.nombre}>Invitado</Text>
            <Text style={styles.email}>
              Registrate para guardar tu historial y tus perfumes.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <PrimaryButton label="Crear cuenta" onPress={() => setAuthVisible(true)} />
            </View>
          </>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.filaPro}>
          <Text style={styles.seccion}>Membresía</Text>
          {isPro && <ProBadge size="sm" />}
        </View>
        {isPro ? (
          <Text style={styles.email}>Tenés acceso completo al sommelier. Gracias por apoyarnos.</Text>
        ) : (
          <>
            <Text style={styles.email}>Plan gratuito · 10 búsquedas por día</Text>
            <View style={{ marginTop: spacing.md }}>
              <PrimaryButton label="Conocer PRO" onPress={() => navigation.navigate('Paywall')} />
            </View>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.seccion}>Tu región</Text>
        <Text style={styles.email}>Define dónde buscamos los precios de compra.</Text>
        <View style={styles.chips}>
          {REGIONES.map((r) => (
            <Chip
              key={r.id}
              label={r.label}
              seleccionado={region === r.id}
              onPress={() => setRegion(r.id, r.moneda)}
            />
          ))}
        </View>
      </View>

      {user && (
        <Pressable onPress={cerrarSesion}>
          <Text style={styles.cerrar}>Cerrar sesión</Text>
        </Pressable>
      )}

      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo },
  contenido: { padding: spacing.lg, paddingTop: spacing.xxl },
  titulo: { ...typography.titulo, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separador,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  nombre: typography.subtitulo,
  email: { ...typography.secundario, marginTop: spacing.xs },
  seccion: { ...typography.subtitulo, fontSize: 16 },
  filaPro: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  cerrar: {
    ...typography.secundario,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
