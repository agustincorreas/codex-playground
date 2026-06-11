import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Chip from '../../components/Chip';
import { spacing, typography } from '../../theme/tokens';

// Selector de rango de precio, con monedas opcionales (ARS/USD/EUR/CLP).
export default function PrecioStep({ paso, valor = {}, onChange }) {
  return (
    <View style={styles.contenedor}>
      <View style={styles.chips}>
        {paso.opciones.map((p) => (
          <Chip
            key={p}
            label={p}
            seleccionado={valor.rango === p}
            onPress={() => onChange({ ...valor, rango: p })}
          />
        ))}
      </View>

      {paso.monedas && (
        <>
          <Text style={styles.label}>Moneda</Text>
          <View style={styles.chips}>
            {paso.monedas.map((m) => (
              <Chip
                key={m}
                label={m}
                seleccionado={valor.moneda === m}
                onPress={() => onChange({ ...valor, moneda: m })}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  label: { ...typography.cuerpo, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm },
});
