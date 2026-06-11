import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import RecommendationCard from '../components/RecommendationCard';
import PrimaryButton from '../components/PrimaryButton';
import AuthSheet from '../components/AuthSheet';
import { useResultsStore } from '../store/useResultsStore';
import { useUserStore } from '../store/useUserStore';
import { useWizardStore } from '../store/useWizardStore';
import { guardarPerfume, quitarGuardado } from '../services/guardados';
import { colors, spacing, typography } from '../theme/tokens';

export default function ResultadosScreen({ navigation }) {
  const { resultados, enriquecidos, busquedaId, error } = useResultsStore();
  const { user, isPro, region } = useUserStore();
  const { modo, respuestas, refinar, reiniciar } = useWizardStore();
  const [guardados, setGuardados] = useState({});
  const [authVisible, setAuthVisible] = useState(false);

  const nombreReferencia =
    respuestas?.perfume_referencia?.nombre || respuestas?.perfume_referencia?.nombre_libre;

  const toggleGuardar = async (perfume) => {
    if (!user) {
      setAuthVisible(true); // guest: invitación a registrarse
      return;
    }
    if (guardados[perfume.id]) {
      await quitarGuardado(user.uid, perfume.id);
      setGuardados((g) => ({ ...g, [perfume.id]: false }));
    } else {
      await guardarPerfume(user.uid, perfume);
      setGuardados((g) => ({ ...g, [perfume.id]: true }));
    }
  };

  if (error) {
    return (
      <View style={styles.vacio}>
        <Text style={styles.tituloVacio}>Ups</Text>
        <Text style={styles.textoVacio}>{error}</Text>
        <PrimaryButton label="Volver" onPress={() => navigation.popToTop()} />
      </View>
    );
  }

  return (
    <View style={styles.pantalla}>
      <FlatList
        data={resultados}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.lista}
        ListHeaderComponent={
          <Text style={styles.titulo}>
            {resultados.length} perfumes para vos
          </Text>
        }
        renderItem={({ item }) => (
          <RecommendationCard
            perfume={item}
            enriquecido={enriquecidos[item.id]}
            isPro={isPro}
            region={region}
            modo={modo}
            nombreReferencia={nombreReferencia}
            guardado={Boolean(guardados[item.id])}
            onGuardar={() => toggleGuardar(item)}
            onUpgrade={() => navigation.navigate('Paywall')}
          />
        )}
        ListFooterComponent={
          <View style={styles.pie}>
            {isPro && (
              <PrimaryButton
                label="Refinar con el sommelier"
                onPress={() => navigation.navigate('Sommelier', { busquedaId })}
              />
            )}
            <PrimaryButton
              label="No me convence ninguno — refinar"
              variante="secundario"
              onPress={() => {
                refinar();
                navigation.navigate('Wizard');
              }}
            />
            <PrimaryButton
              label="Empezar de nuevo"
              variante="secundario"
              onPress={() => {
                reiniciar();
                navigation.popToTop();
              }}
            />
          </View>
        }
      />
      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo },
  lista: { padding: spacing.lg, paddingTop: spacing.xl },
  titulo: { ...typography.titulo, marginBottom: spacing.lg },
  pie: { gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.xxl },
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
