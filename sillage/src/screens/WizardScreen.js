import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import Animated, { SlideInRight, SlideOutLeft } from 'react-native-reanimated';
import { useWizardStore } from '../store/useWizardStore';
import { WIZARDS } from '../wizard/config';
import SearchStep from '../wizard/steps/SearchStep';
import ChipsStep from '../wizard/steps/ChipsStep';
import GridStep from '../wizard/steps/GridStep';
import TextStep from '../wizard/steps/TextStep';
import AjustesStep from '../wizard/steps/AjustesStep';
import PrecioStep from '../wizard/steps/PrecioStep';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography, radius } from '../theme/tokens';

const COMPONENTES = {
  busqueda: SearchStep,
  chips: ChipsStep,
  grid: GridStep,
  texto: TextStep,
  ajustes: AjustesStep,
  precio: PrecioStep,
};

export default function WizardScreen({ navigation }) {
  const { modo, pasoActual, respuestas, responder, avanzar, retroceder } = useWizardStore();
  const pasos = WIZARDS[modo] || [];
  const paso = pasos[pasoActual];

  if (!paso) return null;

  const Componente = COMPONENTES[paso.tipo];
  const valor = respuestas[paso.clave];
  const esUltimo = pasoActual === pasos.length - 1;
  const puedeAvanzar =
    paso.opcional ||
    (valor != null && (Array.isArray(valor) ? valor.length > 0 : true) &&
      (typeof valor !== 'object' || Array.isArray(valor) || Object.keys(valor).length > 0));

  const siguiente = () => {
    if (esUltimo) {
      navigation.navigate('Procesando');
    } else {
      avanzar();
    }
  };

  const atras = () => {
    if (pasoActual === 0) navigation.goBack();
    else retroceder();
  };

  return (
    <View style={styles.pantalla}>
      <View style={styles.progreso}>
        {pasos.map((_, i) => (
          <View key={i} style={[styles.punto, i <= pasoActual && styles.puntoActivo]} />
        ))}
      </View>

      <Animated.View
        key={pasoActual}
        entering={SlideInRight.duration(280)}
        exiting={SlideOutLeft.duration(220)}
        style={styles.contenido}
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.titulo}>{paso.titulo}</Text>
          {paso.opcional && <Text style={styles.opcional}>Opcional</Text>}
          <Componente paso={paso} valor={valor} onChange={(v) => responder(paso.clave, v)} />
        </ScrollView>
      </Animated.View>

      <View style={styles.pie}>
        <Pressable onPress={atras} style={styles.atras}>
          <Text style={styles.atrasTexto}>Atrás</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            label={esUltimo ? 'Buscar mi perfume' : 'Continuar'}
            onPress={siguiente}
            deshabilitado={!puedeAvanzar}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo, paddingTop: spacing.xl },
  progreso: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  punto: {
    flex: 1,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.separador,
  },
  puntoActivo: { backgroundColor: colors.acento },
  contenido: { flex: 1, paddingHorizontal: spacing.lg },
  titulo: { ...typography.titulo, marginTop: spacing.md },
  opcional: { ...typography.secundario, marginTop: spacing.xs },
  pie: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.separador,
  },
  atras: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  atrasTexto: { ...typography.cuerpo, color: colors.textoSecundario },
});
