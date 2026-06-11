// Cadena de fallback de imágenes:
// 1. imagen_url (scrapeada de Fragrantica)
// 2. Wikimedia Commons API: "{marca} {nombre} perfume bottle"
// 3. Placeholder con iniciales de la marca (lo dibuja PerfumeImage)

const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';

export async function buscarImagenWikimedia(marca, nombre) {
  try {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `${marca} ${nombre} perfume bottle`,
      gsrlimit: '1',
      gsrnamespace: '6', // File:
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '400',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`${WIKIMEDIA_API}?${params}`);
    const json = await res.json();
    const pages = json?.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0];
    return first?.imageinfo?.[0]?.thumburl || first?.imageinfo?.[0]?.url || null;
  } catch {
    return null;
  }
}

export function inicialesMarca(marca = '') {
  return marca
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
