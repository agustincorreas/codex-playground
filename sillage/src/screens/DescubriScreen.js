import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { MODOS } from '../wizard/config';
import { useWizardStore } from '../store/useWizardStore';
import { useUserStore } from '../store/useUserStore';
import ProBadge from '../components/ProBadge';
import { colors, radius, spacing, typography, shadows } from '../theme/tokens';

const ICONOS = { heart: '♥', refresh: '↻', calendar: '◷', gift: '✦' };

// Paso 0: elegí tu punto de partida.
export default function DescubriScreen({ navigation }) {
  const iniciar = useWizardStore((s) => s.iniciar);
  const isPro = useUserStore((s) => s.isPro);

  const elegir = (modoDef) => {
    // Modos C y D: gratuito con límite de 5/día. El límite real lo aplica
    // la Cloud Function; acá solo avisamos.
    if (!modoDef.gratisIlimitado && !isPro) {
      Alert.alert(
        'Modo con límite diario',
        'En el plan gratuito este modo permite 5 búsquedas por día. Con PRO es ilimitado.',
        [
          { text: 'Continuar', onPress: () => arrancar(modoDef.id) },
          { text: 'Ver PRO', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }
    arrancar(modoDef.id);
  };

  const arrancar = (modo) => {
    iniciar(modo);
    navigation.navigate('Wizard');
  };

  return (
    <ScrollView style={styles.pantalla} contentContainerStyle={styles.contenido}>
      <Text style={styles.titulo}>Descubrí tu próximo perfume</Text>
      <Text style={styles.subtitulo}>Elegí tu punto de partida</Text>

      {MODOS.map((m) => (
        <Pressable key={m.id} style={styles.card} onPress={() => elegir(m)}>
          <Text style={styles.icono}>{ICONOS[m.icono]}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitulo}>{m.titulo}</Text>
            <Text style={styles.cardDesc}>{m.descripcion}</Text>
          </View>
          {!m.gratisIlimitado && !isPro && <ProBadge size="sm" />}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo },
  contenido: { padding: spacing.lg, paddingTop: spacing.xxl },
  titulo: typography.titulo,
  subtitulo: { ...typography.secundario, marginTop: spacing.xs, marginBottom: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.superficie,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.separador,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  icono: { fontSize: 28, color: colors.acento, width: 40, textAlign: 'center' },
  cardTitulo: typography.subtitulo,
  cardDesc: { ...typography.secundario, marginTop: 2 },
});
