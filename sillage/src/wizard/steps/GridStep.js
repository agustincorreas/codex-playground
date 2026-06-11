import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme/tokens';

// Grid visual de selección única (ocasiones, destinatario, género, clima).
export default function GridStep({ paso, valor, onChange }) {
  return (
    <View style={styles.grid}>
      {paso.opciones.map((op) => {
        const activo = valor === op.id;
        return (
          <Pressable
            key={op.id}
            onPress={() => onChange(op.id)}
            style={[styles.celda, activo && styles.celdaActiva]}
          >
            <Text style={[styles.label, activo && styles.labelActivo]}>{op.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  celda: {
    width: '48%',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.superficie,
    borderWidth: 1,
    borderColor: colors.separador,
    alignItems: 'center',
  },
  celdaActiva: { borderColor: colors.acento, backgroundColor: colors.acentoSecundario + '33' },
  label: { ...typography.cuerpo, textAlign: 'center' },
  labelActivo: { ...typography.cuerpo, color: colors.acento, fontWeight: '600' },
});
