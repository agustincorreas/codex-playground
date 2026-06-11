import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import { colors, radius } from '../theme/tokens';

// Barra dorada de compatibilidad. En tier gratuito no se muestra el
// número; en PRO se muestra el score exacto (0-100).
export default function ScoreBar({ score, mostrarNumero = false }) {
  const ancho = useSharedValue(0);

  useEffect(() => {
    ancho.value = withTiming(Math.min(100, Math.max(0, score)), {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });
  }, [score]);

  const estiloAnimado = useAnimatedStyle(() => ({ width: `${ancho.value}%` }));

  return (
    <View style={styles.fila}>
      <View style={styles.pista}>
        <Animated.View style={[styles.relleno, estiloAnimado]} />
      </View>
      {mostrarNumero && <Text style={styles.numero}>{Math.round(score)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pista: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.separador,
    overflow: 'hidden',
  },
  relleno: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.acento,
  },
  numero: { color: colors.acento, fontWeight: '700', fontSize: 14, width: 32, textAlign: 'right' },
});
