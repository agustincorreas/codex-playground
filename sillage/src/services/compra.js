import { Linking } from 'react-native';

// Búsqueda en el MercadoLibre de la región configurada en el perfil.
const SITIOS_ML = {
  AR: 'https://listado.mercadolibre.com.ar',
  CL: 'https://listado.mercadolibre.cl',
  MX: 'https://listado.mercadolibre.com.mx',
};

export function urlCompra(perfume, region = 'AR') {
  const base = SITIOS_ML[region] || SITIOS_ML.AR;
  const slug = encodeURIComponent(`${perfume.marca} ${perfume.nombre} perfume`)
    .replace(/%20/g, '-');
  return `${base}/${slug}`;
}

export function abrirCompra(perfume, region) {
  return Linking.openURL(urlCompra(perfume, region));
}
