# sillage-db-tools

Herramientas de construcción y mantenimiento de la base de perfumes de
Sillage. **No son parte de la app**: están pensadas como repositorio
separado que corre de forma manual o programada y popula la colección
`perfumes` de Firestore.

## Pipeline

```
scraper_fragrantica.py  →  salida/*.json        (crudo, revisión manual)
scraper_parfumo.py      →  complemento/fallback
dataset_adapter.py      →  fuente 3 (datasets públicos)
normalizer.py           →  normalizado/*.json   (campos inferidos)
uploader.py             →  Firestore (batch upsert)
```

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
export FRAGRANTICA_BASE_URL=https://www.fragrantica.com   # opcional
```

> **Antes de scrapear**: revisá los términos de uso y el `robots.txt` de cada
> sitio. Los scrapers usan delays de 2-4 segundos, identifican el User-Agent
> y soportan modo incremental justamente para minimizar el volumen de
> requests. Si el scraping no es viable, usá la fuente 3 (datasets públicos
> de Kaggle/GitHub con `dataset_adapter.py`).

## 1. Scraping inicial (Fuente 1: Fragrantica)

Objetivo inicial: ~3.000 perfumes priorizando los más populares del mercado
hispanohablante. Se corre por familia olfativa o por letra:

```bash
python scraper_fragrantica.py --inicial --familia Oriental --max 400
python scraper_fragrantica.py --inicial --familia Amaderado --max 400
python scraper_fragrantica.py --inicial --letra D --max 300   # Dior, D&G...
```

- Exporta JSON por lotes de 500 en `salida/`.
- Errores y fichas no procesadas quedan en `errores.log` y
  `salida/no_procesados.txt`.

### Actualización incremental

Solo procesa perfumes cuyas URLs no estén en los JSON previos:

```bash
python scraper_fragrantica.py --incremental --desde salida/ --familia Oriental
```

## 2. Fallback y complemento (Fuente 2: Parfumo)

```bash
# Completa fichas de Fragrantica con campos faltantes (notas, rating)
python scraper_parfumo.py --completar salida/

# O scrapea una marca completa (perfumes europeos / nicho)
python scraper_parfumo.py --marca "Xerjoff" --salida salida/
```

## 3. Fuente 3: datasets públicos

Si los scrapers no son viables, adaptá un dataset comunitario (hay varios en
Kaggle con decenas de miles de entradas de Fragrantica):

```bash
python dataset_adapter.py --csv fra_perfumes.csv --salida salida/
# columnas custom:
python dataset_adapter.py --csv otro.csv --mapeo mapeo.json --salida salida/
```

## 4. Normalización

Infiere los campos calculados del esquema (`ocasiones`, `intensidad`,
`longevidad_estimada`, `sillage_estimado`, `precio_rango` por lista manual de
marcas, `popularidad_score`) y genera los auxiliares `nombre_lower` /
`marca_lower` para el autocompletado de la app:

```bash
python normalizer.py --entrada salida/ --salida normalizado/
```

## 5. Carga a Firestore

Batch writes de a 500, upsert por ID estable (sin duplicar), con reporte de
creados vs actualizados:

```bash
python uploader.py --entrada normalizado/ --dry-run   # primero verificá
python uploader.py --entrada normalizado/
```

## Esquema del documento (colección `perfumes`)

```jsonc
{
  "id": "dior__sauvage-31861",
  "nombre": "Sauvage",
  "marca": "Dior",
  "anio": 2015,
  "genero": "M",                  // "M" | "F" | "U"
  "concentracion": "EDT",         // EDP | EDT | Parfum | EDC | Splash
  "familia_principal": "Aromático",
  "familias_secundarias": ["Fougère"],
  "notas_salida": ["bergamota", "pimienta"],
  "notas_corazon": ["lavanda", "geranio"],
  "notas_fondo": ["ambroxan", "cedro"],
  "descriptores": ["fresco", "especiado", "persistente"],
  "rating": 8.4,                  // 0-10
  "votos": 21000,
  "discontinuado": false,
  "imagen_url": "https://...",
  "url_fragrantica": "https://...",
  "popularidad_score": 84.0,      // calculado
  "ocasiones": ["diario", "trabajo", "verano"],   // inferido
  "intensidad": 3,                // 1-5, inferido
  "longevidad_estimada": 4,       // 1-5, inferido
  "sillage_estimado": 4,          // 1-5, inferido
  "precio_rango": "premium",      // por lista manual de marcas
  "nombre_lower": "sauvage",      // autocompletado
  "marca_lower": "dior",
  "creado_at": "...", "actualizado_at": "..."
}
```
