import React from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme/tokens';

export default function TextStep({ paso, valor = '', onChange }) {
  return (
    <View style={styles.contenedor}>
      <TextInput
        style={styles.input}
        value={valor}
        onChangeText={onChange}
        placeholder={paso.placeholder}
        placeholderTextColor={colors.textoSecundario + '99'}
        multiline
        maxLength={paso.maxCaracteres || 300}
      />
      <Text style={styles.contador}>
        {valor.length}/{paso.maxCaracteres || 300}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { marginTop: spacing.md },
  input: {
    ...typography.cuerpo,
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separador,
    padding: spacing.md,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  contador: { ...typography.secundario, textAlign: 'right', marginTop: spacing.xs },
});
