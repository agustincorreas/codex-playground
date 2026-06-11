import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { chatSommelier } from '../services/api';
import { colors, radius, spacing, typography } from '../theme/tokens';

// Chat conversacional premium, pre-cargado con el contexto de la búsqueda.
export default function SommelierScreen({ route }) {
  const { busquedaId } = route.params || {};
  const [mensajes, setMensajes] = useState([
    {
      rol: 'assistant',
      texto: 'Ya tengo el contexto de tu búsqueda. ¿Querés ajustar algo? Puedo buscar opciones más frescas, más intensas, de otra familia o de otro presupuesto.',
    },
  ]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const lista = useRef(null);

  const enviar = async () => {
    const contenido = texto.trim();
    if (!contenido || pensando) return;
    const nuevos = [...mensajes, { rol: 'user', texto: contenido }];
    setMensajes(nuevos);
    setTexto('');
    setPensando(true);
    try {
      const { respuesta } = await chatSommelier(
        busquedaId,
        nuevos.map((m) => ({ role: m.rol, content: m.texto }))
      );
      setMensajes((prev) => [...prev, { rol: 'assistant', texto: respuesta }]);
    } catch {
      setMensajes((prev) => [
        ...prev,
        { rol: 'assistant', texto: 'Se me nubló el olfato un segundo. Probá de nuevo.' },
      ]);
    } finally {
      setPensando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.pantalla}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={lista}
        data={mensajes}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.lista}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.burbuja, item.rol === 'user' ? styles.usuario : styles.sommelier]}>
            <Text style={styles.textoBurbuja}>{item.texto}</Text>
          </View>
        )}
        ListFooterComponent={
          pensando ? <Text style={styles.pensando}>El sommelier está oliendo...</Text> : null
        }
      />
      <View style={styles.entrada}>
        <TextInput
          style={styles.input}
          value={texto}
          onChangeText={setTexto}
          placeholder="Ej: algo más fresco pero que dure igual"
          placeholderTextColor={colors.textoSecundario + '99'}
          onSubmitEditing={enviar}
          returnKeyType="send"
        />
        <Pressable style={styles.enviar} onPress={enviar}>
          <Text style={styles.enviarTexto}>→</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.fondo },
  lista: { padding: spacing.lg, gap: spacing.sm },
  burbuja: {
    maxWidth: '85%',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  usuario: {
    alignSelf: 'flex-end',
    backgroundColor: colors.acentoSecundario,
    borderBottomRightRadius: radius.sm,
  },
  sommelier: {
    alignSelf: 'flex-start',
    backgroundColor: colors.superficie,
    borderWidth: 1,
    borderColor: colors.separador,
    borderBottomLeftRadius: radius.sm,
  },
  textoBurbuja: typography.cuerpo,
  pensando: { ...typography.secundario, fontStyle: 'italic', marginLeft: spacing.sm },
  entrada: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.separador,
  },
  input: {
    ...typography.cuerpo,
    flex: 1,
    backgroundColor: colors.superficie,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.separador,
  },
  enviar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.acento,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enviarTexto: { color: colors.fondo, fontSize: 20, fontWeight: '700' },
});
