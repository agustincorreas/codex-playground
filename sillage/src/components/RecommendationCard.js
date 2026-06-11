import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import PerfumeImage from './PerfumeImage';
import ScoreBar from './ScoreBar';
import ProBadge from './ProBadge';
import Chip from './Chip';
import PrimaryButton from './PrimaryButton';
import { abrirCompra } from '../services/compra';
import { colors, radius, spacing, typography, shadows } from '../theme/tokens';

// Card de resultado. En tier gratuito la sección de IA aparece con blur
// y candado; en PRO se muestra desbloqueada con score numérico y desglose.
export default function RecommendationCard({
  perfume,          // doc de perfumes + { score, desglose }
  enriquecido,      // { explicacion, cuando_usarlo, por_que_reemplaza } | null
  isPro,
  region,
  modo,             // 'A' | 'B' | 'C' | 'D'
  nombreReferencia, // para "Por qué reemplaza a [X]"
  guardado,
  onGuardar,
  onUpgrade,
}) {
  const notas = [
    ...(perfume.notas_salida || []).slice(0, 2),
    ...(perfume.notas_corazon || []).slice(0, 2),
    ...(perfume.notas_fondo || []).slice(0, 2),
  ];

  return (
    <View style={[styles.card, isPro && styles.cardPro]}>
      <View style={styles.cabecera}>
        <PerfumeImage perfume={perfume} size={88} />
        <View style={styles.info}>
          <Text style={styles.nombre}>{perfume.nombre}</Text>
          <Text style={styles.marca}>{perfume.marca}</Text>
          <Text style={styles.meta}>
            {perfume.familia_principal} · {perfume.concentracion}
          </Text>
          <ScoreBar score={perfume.score} mostrarNumero={isPro} />
        </View>
      </View>

      <View style={styles.notas}>
        {notas.map((n) => (
          <Chip key={n} label={n} small seleccionado={false} />
        ))}
      </View>

      {isPro && perfume.desglose && (
        <View style={styles.desglose}>
          {Object.entries(perfume.desglose).map(([dim, pts]) => (
            <Text key={dim} style={styles.desgloseItem}>
              {dim}: <Text style={styles.desglosePts}>{pts}</Text>
            </Text>
          ))}
        </View>
      )}

      {/* Sección IA: desbloqueada en PRO, con blur y candado en gratuito */}
      <View style={styles.seccionIA}>
        {isPro && enriquecido ? (
          <>
            <Text style={styles.tituloIA}>¿Por qué te lo recomendamos?</Text>
            <Text style={styles.cuerpoIA}>{enriquecido.explicacion}</Text>
            <Text style={styles.tituloIA}>Cuándo usarlo y cómo</Text>
            <Text style={styles.cuerpoIA}>{enriquecido.cuando_usarlo}</Text>
            {modo === 'B' && enriquecido.por_que_reemplaza && (
              <>
                <Text style={styles.tituloIA}>
                  Por qué reemplaza a {nombreReferencia || 'tu perfume'}
                </Text>
                <Text style={styles.cuerpoIA}>{enriquecido.por_que_reemplaza}</Text>
              </>
            )}
          </>
        ) : (
          <View style={styles.bloqueado}>
            <Text style={styles.tituloIA}>¿Por qué te lo recomendamos?</Text>
            <Text style={styles.cuerpoIA} numberOfLines={3}>
              Esta recomendación tiene una explicación detallada del sommelier:
              qué notas conectan con lo que buscás, cuándo conviene usarlo y cómo
              sacarle el máximo provecho.
            </Text>
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={styles.candado}>
              <ProBadge />
              <Text style={styles.candadoTexto}>🔒</Text>
            </View>
            <Pressable style={styles.ctaUpgrade} onPress={onUpgrade}>
              <Text style={styles.ctaUpgradeTexto}>Desbloqueá todo con membresía PRO</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.acciones}>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            label="Ver dónde comprar"
            onPress={() => abrirCompra(perfume, region)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            label={guardado ? 'Guardado ✓' : 'Guardar'}
            variante="secundario"
            onPress={onGuardar}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.superficie,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.separador,
    ...shadows.card,
  },
  cardPro: { borderColor: colors.acento + '66' },
  cabecera: { flexDirection: 'row', gap: spacing.md },
  info: { flex: 1, justifyContent: 'space-between', paddingVertical: 2 },
  nombre: typography.subtitulo,
  marca: { ...typography.secundario, color: colors.acento },
  meta: typography.secundario,
  notas: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  desglose: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.separador,
  },
  desgloseItem: { ...typography.secundario, fontSize: 12 },
  desglosePts: { color: colors.acento, fontWeight: '700' },
  seccionIA: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  bloqueado: {
    padding: spacing.md,
    backgroundColor: colors.fondo,
    borderRadius: radius.md,
    minHeight: 140,
  },
  tituloIA: { ...typography.cuerpo, fontWeight: '700', marginTop: spacing.sm },
  cuerpoIA: { ...typography.secundario, marginTop: spacing.xs },
  candado: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  candadoTexto: { fontSize: 16 },
  ctaUpgrade: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.acento,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  ctaUpgradeTexto: { color: colors.fondo, fontWeight: '700', fontSize: 14 },
  acciones: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
