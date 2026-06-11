import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { buscarPerfumes } from '../../services/perfumes';
import PerfumeImage from '../../components/PerfumeImage';
import { colors, radius, spacing, typography } from '../../theme/tokens';

// Buscador con autocompletado contra Firestore (mínimo 3 caracteres).
// Si el perfume no aparece, se permite texto libre con aviso.
export default function SearchStep({ paso, valor, onChange }) {
  const [texto, setTexto] = useState(valor?.nombre_libre || '');
  const [sugerencias, setSugerencias] = useState([]);
  const debounce = useRef(null);

  useEffect(() => {
    if (valor?.id) return; // ya hay selección
    clearTimeout(debounce.current);
    if (texto.trim().length < 3) {
      setSugerencias([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const res = await buscarPerfumes(texto, {
        incluirDiscontinuados: paso.incluirDiscontinuados !== false,
      });
      setSugerencias(res);
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [texto]);

  const seleccionar = (perfume) => {
    setSugerencias([]);
    setTexto(`${perfume.nombre} — ${perfume.marca}`);
    onChange({ id: perfume.id, nombre: perfume.nombre, marca: perfume.marca });
  };

  const escribir = (t) => {
    setTexto(t);
    // Texto libre: el matching será menos preciso (se usa como keywords).
    onChange(paso.permiteTextoLibre && t.trim() ? { nombre_libre: t.trim() } : null);
  };

  return (
    <View style={styles.contenedor}>
      <TextInput
        style={styles.input}
        value={texto}
        onChangeText={escribir}
        placeholder="Nombre o marca (mín. 3 letras)"
        placeholderTextColor={colors.textoSecundario + '99'}
        autoCorrect={false}
      />
      {sugerencias.length > 0 && (
        <FlatList
          style={styles.lista}
          data={sugerencias}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable style={styles.item} onPress={() => seleccionar(item)}>
              <PerfumeImage perfume={item} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemNombre}>{item.nombre}</Text>
                <Text style={styles.itemMarca}>
                  {item.marca}
                  {item.discontinuado ? '  ·  Discontinuado' : ''}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
      {valor?.nombre_libre && (
        <Text style={styles.aviso}>
          No encontramos ese perfume en la base: lo usaremos como texto libre y el
          matching será menos preciso.
        </Text>
      )}
      {paso.ayuda && !valor?.nombre_libre && <Text style={styles.ayuda}>{paso.ayuda}</Text>}
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
  },
  lista: {
    maxHeight: 320,
    marginTop: spacing.sm,
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separador,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separador,
  },
  itemNombre: typography.cuerpo,
  itemMarca: typography.secundario,
  aviso: { ...typography.secundario, color: colors.acento, marginTop: spacing.sm },
  ayuda: { ...typography.secundario, marginTop: spacing.sm },
});
