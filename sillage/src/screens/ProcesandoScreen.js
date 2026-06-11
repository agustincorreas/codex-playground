import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useWizardStore } from '../store/useWizardStore';
import { useUserStore } from '../store/useUserStore';
import { useResultsStore } from '../store/useResultsStore';
import { pedirRecomendaciones, pedirEnriquecimiento } from '../services/api';
import { guardarBusqueda } from '../services/historial';
import { DEMO } from '../config/demo';
import { colors, spacing, typography } from '../theme/tokens';

const TEXTOS = [
  'Analizando familias olfativas...',
  'Cruzando pirámides de notas...',
  'Filtrando por ocasión y contexto...',
  'Calculando compatibilidad...',
  'Priorizando disponibilidad en tu región...',
];

export default function ProcesandoScreen({ navigation }) {
  const [indice, setIndice] = useState(0);
  const payload = useWizardStore((s) => s.payload);
  const { isPro, deviceId, region } = useUserStore();
  const { setResultados, setEnriquecidos, setError } = useResultsStore();
  const montado = useRef(true);

  useEffect(() => {
    const intervalo = setInterval(
      () => setIndice((i) => (i + 1) % TEXTOS.length),
      2000
    );
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    montado.current = true;
    (async () => {
      try {
        const input = payload();
        const data = await pedirRecomendaciones({
          ...input,
          deviceId,
          region,
        });
        if (!montado.current) return;
        setResultados(data.resultados, data.busquedaId);
        navigation.replace('Resultados');
        // En demo el backend no existe: el historial se guarda localmente.
        if (DEMO) {
          guardarBusqueda('demo', data.busquedaId, {
            input,
            resultados: data.resultados,
          }).catch(() => {});
        }
        // El enriquecimiento premium corre en paralelo después de navegar:
        // las cards muestran la sección IA apenas llega.
        if (isPro && data.busquedaId) {
          const contextoDemo = {
            resultados: data.resultados,
            modo: input.modo,
            nombreReferencia:
              input.perfume_referencia?.nombre || input.perfume_referencia?.nombre_libre,
          };
          pedirEnriquecimiento(data.busquedaId, contextoDemo)
            .then((enriquecidos) => setEnriquecidos(enriquecidos))
            .catch(() => {});
        }
      } catch (e) {
        if (!montado.current) return;
        setError(
          e?.message?.includes('resource-exhausted')
            ? 'Alcanzaste el límite diario de búsquedas. Volvé mañana o pasate a PRO.'
            : 'No pudimos completar la búsqueda. Probá de nuevo.'
        );
        navigation.replace('Resultados');
      }
    })();
    return () => { montado.current = false; };
  }, []);

  return (
    <View style={styles.pantalla}>
      <ActivityIndicator size="large" color={colors.acento} />
      <Animated.Text
        key={indice}
        entering={FadeIn.duration(350)}
        exiting={FadeOut.duration(250)}
        style={styles.texto}
      >
        {TEXTOS[indice]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colors.fondo,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  texto: { ...typography.cuerpo, color: colors.textoSecundario, textAlign: 'center' },
});
