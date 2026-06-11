import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PrimaryButton from '../components/PrimaryButton';
import ProBadge from '../components/ProBadge';
import { obtenerOfertas, comprar, restaurar } from '../config/revenuecat';
import { useUserStore } from '../store/useUserStore';
import { colors, gradients, radius, spacing, typography } from '../theme/tokens';

const BENEFICIOS = [
  { icono: '✦', texto: 'Explicaciones detalladas de cada recomendación' },
  { icono: '✦', texto: 'Chat con el sommelier virtual para refinar resultados' },
  { icono: '✦', texto: 'Acceso ilimitado a todos los modos' },
];

const COMPARATIVA = [
  ['Recomendaciones por matching', '✓', '✓'],
  ['Búsquedas diarias', '10', 'Ilimitadas'],
  ['Modos ocasión y regalo', '5/día', 'Ilimitados'],
  ['Explicación del sommelier', '—', '✓'],
  ['Chat conversacional', '—', '✓'],
  ['Score exacto y desglose', '—', '✓'],
];

export default function PaywallScreen({ navigation }) {
  const [oferta, setOferta] = useState(null);
  const [comprando, setComprando] = useState(false);
  const setPro = useUserStore((s) => s.setPro);

  useEffect(() => {
    obtenerOfertas().then(setOferta).catch(() => {});
  }, []);

  const mensual = oferta?.monthly;
  const anual = oferta?.annual;

  const ahorro = (() => {
    if (!mensual || !anual) return null;
    const anualizado = mensual.product.price * 12;
    return Math.round((1 - anual.product.price / anualizado) * 100);
  })();

  const suscribir = async (pkg) => {
    if (!pkg) return;
    setComprando(true);
    try {
      const ok = await comprar(pkg);
      if (ok) {
        setPro(true);
        navigation.goBack();
      }
    } catch (e) {
      if (!e.userCancelled) Alert.alert('Error', 'No pudimos procesar la compra.');
    } finally {
      setComprando(false);
    }
  };

  const onRestaurar = async () => {
    const ok = await restaurar();
    setPro(ok);
    Alert.alert(ok ? 'Listo' : 'Sin compras', ok
      ? 'Tu membresía PRO fue restaurada.'
      : 'No encontramos compras anteriores en esta cuenta.');
    if (ok) navigation.goBack();
  };

  return (
    <LinearGradient colors={gradients.paywall} style={styles.pantalla}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <ProBadge />
        <Text style={styles.titulo}>Tu sommelier personal,{'\n'}siempre con vos</Text>
        <Text style={styles.subtitulo}>
          Las mismas recomendaciones, con el porqué detrás de cada una.
        </Text>

        <View style={styles.beneficios}>
          {BENEFICIOS.map((b) => (
            <View key={b.texto} style={styles.beneficio}>
              <Text style={styles.beneficioIcono}>{b.icono}</Text>
              <Text style={styles.beneficioTexto}>{b.texto}</Text>
            </View>
          ))}
        </View>

        <View style={styles.tabla}>
          <View style={styles.filaTabla}>
            <Text style={[styles.celda, styles.celdaTitulo, { flex: 2 }]} />
            <Text style={[styles.celda, styles.celdaTitulo]}>Gratuito</Text>
            <Text style={[styles.celda, styles.celdaTitulo, styles.celdaPro]}>PRO</Text>
          </View>
          {COMPARATIVA.map(([feature, free, pro]) => (
            <View key={feature} style={styles.filaTabla}>
              <Text style={[styles.celda, { flex: 2, textAlign: 'left' }]}>{feature}</Text>
              <Text style={styles.celda}>{free}</Text>
              <Text style={[styles.celda, styles.celdaPro]}>{pro}</Text>
            </View>
          ))}
        </View>

        <PrimaryButton
          label={mensual ? `Mensual · ${mensual.product.priceString}` : 'Suscripción mensual'}
          onPress={() => suscribir(mensual)}
          cargando={comprando}
        />
        <View style={{ height: spacing.sm }} />
        <View>
          <PrimaryButton
            label={anual ? `Anual · ${anual.product.priceString}` : 'Suscripción anual'}
            variante="secundario"
            onPress={() => suscribir(anual)}
          />
          {ahorro > 0 && (
            <View style={styles.badgeAhorro}>
              <Text style={styles.badgeAhorroTexto}>Ahorrás {ahorro}%</Text>
            </View>
          )}
        </View>

        <Pressable onPress={onRestaurar}>
          <Text style={styles.restaurar}>Restaurar compra</Text>
        </Pressable>

        <Text style={styles.legal}>
          La suscripción se renueva automáticamente salvo que se cancele al menos 24 horas
          antes del fin del período vigente. El cobro se realiza a través de tu cuenta de
          App Store o Google Play. Podés administrar y cancelar la suscripción desde la
          configuración de tu tienda. Al suscribirte aceptás nuestros Términos de Servicio
          y Política de Privacidad.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  contenido: { padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxl },
  titulo: { ...typography.titulo, fontSize: 30, marginTop: spacing.md },
  subtitulo: { ...typography.secundario, fontSize: 15, marginTop: spacing.sm },
  beneficios: { marginVertical: spacing.lg, gap: spacing.md },
  beneficio: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  beneficioIcono: { color: colors.acento, fontSize: 18 },
  beneficioTexto: typography.cuerpo,
  tabla: {
    backgroundColor: colors.superficie + 'CC',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separador,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  filaTabla: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separador,
  },
  celda: { ...typography.secundario, flex: 1, textAlign: 'center' },
  celdaTitulo: { fontWeight: '700', color: colors.texto },
  celdaPro: { color: colors.acento, fontWeight: '600' },
  badgeAhorro: {
    position: 'absolute',
    top: -10,
    right: spacing.md,
    backgroundColor: colors.acento,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeAhorroTexto: { color: colors.fondo, fontSize: 11, fontWeight: '800' },
  restaurar: {
    ...typography.secundario,
    color: colors.acento,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  legal: { ...typography.secundario, fontSize: 11, marginTop: spacing.lg, lineHeight: 16 },
});
