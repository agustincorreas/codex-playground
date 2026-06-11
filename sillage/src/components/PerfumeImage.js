import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { buscarImagenWikimedia, inicialesMarca } from '../services/imagenes';
import { colors, gradients, radius } from '../theme/tokens';

// Cadena de fallback: imagen_url -> Wikimedia Commons -> placeholder con iniciales.
// expo-image cachea en disco y funciona en Expo Go, web y builds nativos.
export default function PerfumeImage({ perfume, size = 96 }) {
  const [uri, setUri] = useState(perfume.imagen_url || null);
  const [fallo, setFallo] = useState(!perfume.imagen_url);

  useEffect(() => {
    let activo = true;
    if (fallo && uri !== null) return;
    if (fallo) {
      buscarImagenWikimedia(perfume.marca, perfume.nombre).then((url) => {
        if (activo && url) {
          setUri(url);
          setFallo(false);
        }
      });
    }
    return () => { activo = false; };
  }, [fallo]);

  if (uri && !fallo) {
    return (
      <Image
        source={{ uri }}
        style={[styles.imagen, { width: size, height: size }]}
        contentFit="contain"
        cachePolicy="disk"
        transition={200}
        onError={() => {
          // La URL scrapeada expiró: probamos Wikimedia una sola vez.
          setUri(null);
          setFallo(true);
        }}
      />
    );
  }

  return (
    <LinearGradient
      colors={gradients.placeholder}
      style={[styles.placeholder, { width: size, height: size }]}
    >
      <Text style={[styles.iniciales, { fontSize: size / 3 }]}>
        {inicialesMarca(perfume.marca)}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  imagen: { borderRadius: radius.md, backgroundColor: colors.superficie },
  placeholder: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iniciales: { color: colors.acento, fontWeight: '700', letterSpacing: 2 },
});
