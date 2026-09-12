# Codex Playground - Utilidades Básicas en Python

Este repositorio incluye varios scripts simples para probar OpenAI Codex o GitHub Copilot. 
Son útiles para jugar, mejorar código y experimentar.

## Archivos incluidos

- `calculadora.py`: funciones básicas de suma, resta, multiplicación y división.
- `convertidor_temperatura.py`: convierte entre Celsius y Fahrenheit.
- `lector_excel.py`: lee un archivo de Excel y muestra su contenido (requiere `pandas`).
- `generador_contraseñas.py`: genera contraseñas aleatorias seguras.

## Proyecto: Prisma Synth — Sintetizador digital

- [`prisma-synth/`](prisma-synth/README.md): sintetizador multi-motor para navegador (Web Audio / AudioWorklet) inspirado en Arturia Pigments: motores Analog, Wavetable, FM, Granular, Harmonic, Modal y Sample; dos filtros; modulación por arrastrar y soltar; vista Play con macros y visualizador; arpegiador y efectos (incluido un Corroder). Abrí `prisma-synth/dist/prisma-synth.html` para probarlo sin instalar nada.

## Proyecto: Sillage — Recomendador de perfumes

- [`sillage/`](sillage/README.md): app React Native (Expo) con tier gratuito y membresía PRO.
- [`functions/`](functions/): Cloud Functions (motor de matching, enriquecimiento GPT-4o, rate limiting, webhook RevenueCat).
- [`sillage-db-tools/`](sillage-db-tools/README.md): scripts Python de scraping, normalización y carga de la base de perfumes (pensado como repositorio separado).
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`: configuración de Firebase.

Setup completo en [`sillage/README.md`](sillage/README.md).