import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients, radius, spacing } from '../theme/tokens';

export default function ProBadge({ size = 'md' }) {
  return (
    <LinearGradient
      colors={gradients.pro}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.badge, size === 'sm' && styles.sm]}
    >
      <Text style={[styles.texto, size === 'sm' && styles.textoSm]}>PRO</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  texto: { color: '#0F0E0C', fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  textoSm: { fontSize: 10 },
});
