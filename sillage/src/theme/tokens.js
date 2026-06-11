// Design tokens centralizados — única fuente de verdad para estilos.

export const colors = {
  fondo: '#0F0E0C',
  superficie: '#1C1A16',
  acento: '#C9A96E',
  acentoSecundario: '#7C5C3E',
  texto: '#F2EDE4',
  textoSecundario: '#A89880',
  separador: '#2C2820',
  error: '#C96E6E',
  exito: '#8FAE7C',
};

export const gradients = {
  pro: ['#E3C98F', '#C9A96E', '#9C7B4C'],
  paywall: ['#1C1A16', '#2A2118', '#0F0E0C'],
  placeholder: ['#2C2820', '#1C1A16'],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const typography = {
  titulo: { fontSize: 26, fontWeight: '700', color: colors.texto, letterSpacing: 0.3 },
  subtitulo: { fontSize: 18, fontWeight: '600', color: colors.texto },
  cuerpo: { fontSize: 15, fontWeight: '400', color: colors.texto, lineHeight: 22 },
  secundario: { fontSize: 13, fontWeight: '400', color: colors.textoSecundario, lineHeight: 19 },
  chip: { fontSize: 13, fontWeight: '500', color: colors.texto },
  boton: { fontSize: 16, fontWeight: '600', color: colors.fondo },
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
};
