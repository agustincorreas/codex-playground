import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listarGuardados, quitarGuardado } from '../services/guardados';
import { abrirCompra } from '../services/compra';
import { useUserStore } from '../store/useUserStore';
import AuthSheet from '../components/AuthSheet';
import PerfumeImage from '../components/PerfumeImage';
import PrimaryButton from '../components/PrimaryButton';
import { DEMO } from '../config/demo';
import { colors, radius, spacing, typography } from '../theme/tokens';

export default function GuardadosScreen() {
  const { user, region } = useUserStore();
  const [items, setItems] = useState([]);
  const [authVisible, setAuthVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user || DEMO) listarGuardados(user?.uid || 'demo').then(setItems);
    }, [user])
  );

  const quitar = async (id) => {
    await quitarGuardado(user?.uid || 'demo', id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (!user && !DEMO) {
    return (
      <View style={styles.vacio}>
        <Text style={styles.tituloVacio}>Tus perfumes guardados</Text>
        <Text style={styles.textoVacio}>
          Registrate para armar tu colección de descubrimientos.
        </Text>
        <PrimaryButton label="Crear cuenta" onPress={() => setAuthVisible(true)} />
        <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.pantalla}
      contentContainerStyle={styles.lista}
      data={items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<Text style={styles.titulo}>Guardados</Text>}
      ListEmptyComponent={
        <Text style={styles.textoVacio}>Todavía no guardaste ningún perfume.</Text>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <PerfumeImage perfume={item} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={styles.nombre}>{item.nombre}</Text>
            <Text style={styles.marca}>{item.marca}</Text>
            <Pressable onPress={() => abrirCompra(item, region)}>
              <Text style={styles.comprar}>Ver dónde comprar →</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => quitar(item.id)} hitSlop={8}>
            <Text style={styles.quitar}>✕</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo },
  lista: { padding: spacing.lg, paddingTop: spacing.xxl },
  titulo: { ...typography.titulo, marginBottom: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separador,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  nombre: typography.subtitulo,
  marca: { ...typography.secundario, color: colors.acento },
  comprar: { ...typography.secundario, color: colors.acento, marginTop: spacing.sm },
  quitar: { color: colors.textoSecundario, fontSize: 16, padding: spacing.xs },
  vacio: {
    flex: 1,
    backgroundColor: colors.fondo,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  tituloVacio: typography.titulo,
  textoVacio: { ...typography.secundario, textAlign: 'center' },
});
