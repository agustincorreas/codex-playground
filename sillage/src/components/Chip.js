import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/tokens';

export default function Chip({ label, seleccionado, onPress, small }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, small && styles.small, seleccionado && styles.activo]}
    >
      <Text style={[styles.texto, seleccionado && styles.textoActivo]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.separador,
    backgroundColor: colors.superficie,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  small: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  activo: { borderColor: colors.acento, backgroundColor: colors.acentoSecundario + '33' },
  texto: typography.chip,
  textoActivo: { ...typography.chip, color: colors.acento },
});
