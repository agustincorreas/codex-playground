import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import Chip from '../../components/Chip';
import { colors, spacing, typography } from '../../theme/tokens';

// Paso de sliders (similitud, intensidad, fidelidad, edad) con
// selector de precio opcional al pie.
export default function AjustesStep({ paso, valor = {}, onChange }) {
  const setCampo = (clave, v) => onChange({ ...valor, [clave]: v });

  return (
    <View style={styles.contenedor}>
      {paso.sliders.map((s) => (
        <View key={s.clave} style={styles.bloque}>
          <Text style={styles.label}>
            {s.label}
            {valor[s.clave] != null && (
              <Text style={styles.valor}>  {valor[s.clave]}{s.clave === 'edad' && valor[s.clave] >= s.max ? '+' : ''}</Text>
            )}
          </Text>
          <Slider
            minimumValue={s.min}
            maximumValue={s.max}
            step={1}
            value={valor[s.clave] ?? Math.round((s.min + s.max) / 2)}
            onSlidingComplete={(v) => setCampo(s.clave, v)}
            minimumTrackTintColor={colors.acento}
            maximumTrackTintColor={colors.separador}
            thumbTintColor={colors.acento}
          />
          <View style={styles.extremos}>
            <Text style={typography.secundario}>{s.izq}</Text>
            <Text style={typography.secundario}>{s.der}</Text>
          </View>
        </View>
      ))}

      {paso.precio && (
        <View style={styles.bloque}>
          <Text style={styles.label}>Precio</Text>
          <View style={styles.chips}>
            {paso.precio.map((p) => (
              <Chip
                key={p}
                label={p}
                seleccionado={valor.precio === p}
                onPress={() => setCampo('precio', p)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { marginTop: spacing.md },
  bloque: { marginBottom: spacing.lg },
  label: { ...typography.cuerpo, fontWeight: '600', marginBottom: spacing.sm },
  valor: { color: colors.acento, fontWeight: '700' },
  extremos: { flexDirection: 'row', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
