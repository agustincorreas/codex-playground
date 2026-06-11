import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listarHistorial } from '../services/historial';
import { useUserStore } from '../store/useUserStore';
import { useResultsStore } from '../store/useResultsStore';
import AuthSheet from '../components/AuthSheet';
import PrimaryButton from '../components/PrimaryButton';
import { MODOS } from '../wizard/config';
import { DEMO } from '../config/demo';
import { colors, radius, spacing, typography } from '../theme/tokens';

export default function HistorialScreen({ navigation }) {
  const user = useUserStore((s) => s.user);
  const { setResultados, setEnriquecidos } = useResultsStore();
  const [items, setItems] = useState([]);
  const [authVisible, setAuthVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user || DEMO) listarHistorial(user?.uid || 'demo').then(setItems);
    }, [user])
  );

  const abrir = (item) => {
    // Los resultados premium guardados ya traen las explicaciones:
    // no se vuelve a llamar a la IA.
    setResultados(item.resultados || [], item.id);
    setEnriquecidos(item.enriquecidos || {});
    navigation.navigate('DescubriStack', { screen: 'Resultados' });
  };

  if (!user && !DEMO) {
    return (
      <View style={styles.vacio}>
        <Text style={styles.tituloVacio}>Tu historial te espera</Text>
        <Text style={styles.textoVacio}>
          Registrate para guardar cada búsqueda y volver a tus recomendaciones cuando quieras.
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
      ListHeaderComponent={<Text style={styles.titulo}>Historial</Text>}
      ListEmptyComponent={
        <Text style={styles.textoVacio}>Todavía no hiciste ninguna búsqueda.</Text>
      }
      renderItem={({ item }) => {
        const modo = MODOS.find((m) => m.id === item.input?.modo);
        return (
          <Pressable style={styles.card} onPress={() => abrir(item)}>
            <Text style={styles.cardTitulo}>{modo?.titulo || 'Búsqueda'}</Text>
            <Text style={styles.cardDetalle} numberOfLines={2}>
              {(item.resultados || []).map((r) => r.nombre).join(' · ')}
            </Text>
            <Text style={styles.fecha}>
              {item.creado_at?.toDate?.().toLocaleDateString('es-AR') ||
                (typeof item.creado_at === 'number'
                  ? new Date(item.creado_at).toLocaleDateString('es-AR')
                  : '')}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo },
  lista: { padding: spacing.lg, paddingTop: spacing.xxl },
  titulo: { ...typography.titulo, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separador,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitulo: typography.subtitulo,
  cardDetalle: { ...typography.secundario, marginTop: spacing.xs },
  fecha: { ...typography.secundario, fontSize: 11, marginTop: spacing.sm },
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
