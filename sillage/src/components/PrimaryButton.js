import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/tokens';

export default function PrimaryButton({ label, onPress, variante = 'primario', deshabilitado, cargando }) {
  const esPrimario = variante === 'primario';
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado || cargando}
      style={[
        styles.boton,
        esPrimario ? styles.primario : styles.secundario,
        (deshabilitado || cargando) && styles.deshabilitado,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={esPrimario ? colors.fondo : colors.acento} />
      ) : (
        <Text style={[styles.texto, !esPrimario && styles.textoSecundario]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  boton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primario: { backgroundColor: colors.acento },
  secundario: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.acento,
  },
  deshabilitado: { opacity: 0.4 },
  texto: typography.boton,
  textoSecundario: { ...typography.boton, color: colors.acento },
});
