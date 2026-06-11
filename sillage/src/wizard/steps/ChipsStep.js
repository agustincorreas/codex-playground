import React from 'react';
import { View, StyleSheet } from 'react-native';
import Chip from '../../components/Chip';
import { spacing } from '../../theme/tokens';

export default function ChipsStep({ paso, valor = [], onChange }) {
  const toggle = (opcion) => {
    if (!paso.multiple) return onChange([opcion]);
    onChange(
      valor.includes(opcion) ? valor.filter((v) => v !== opcion) : [...valor, opcion]
    );
  };

  return (
    <View style={styles.contenedor}>
      {paso.opciones.map((op) => (
        <Chip key={op} label={op} seleccionado={valor.includes(op)} onPress={() => toggle(op)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
});
