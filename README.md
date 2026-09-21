# Codex Playground - Utilidades Básicas en Python

Este repositorio incluye varios scripts simples para probar OpenAI Codex o GitHub Copilot. 
Son útiles para jugar, mejorar código y experimentar.

## Archivos incluidos

- `calculadora.py`: funciones básicas de suma, resta, multiplicación y división.
- `convertidor_temperatura.py`: convierte entre Celsius y Fahrenheit.
- `lector_excel.py`: lee un archivo de Excel y muestra su contenido (requiere `pandas`).
- `generador_contraseñas.py`: genera contraseñas aleatorias seguras.

## Proyecto: Armonía — generador de armonías semi-modular

- [`armonia/`](armonia/README.md): sintetizador generador de acordes inspirado en el Orchid de
  Telepathic Instruments. Fundamental en el teclado, tipo + modificadores con botones, Voicing Dial
  en cascada, modos de performance (strum, arp, patterns, harp), beats, looper y MIDI in/out.
  Sin dependencias: abrí `armonia/armonia.html`.

## Proyecto: Ensayo — practicá los temas de tu banda sin tu banda

- [`ensayo/`](ensayo/README.md): app web para músicos (guitarra, bajo, batería, voz, teclado) que
  necesitan ensayar un repertorio. Elegís tu instrumento, armás la setlist, cada tema tiene un
  backing track sin tu instrumento (YouTube, archivo propio o metrónomo) y la app te muestra la
  **letra y los acordes sincronizados**, con loop A-B, cambio de velocidad, transposición, count-in,
  modo "Sincronizar" para marcar los tiempos y grabación de audio/video de tus tomas. Sin
  dependencias ni build: abrí `ensayo/index.html` desde un servidor local o en
  https://agustincorreas.github.io/codex-playground/ensayo/. El README incluye la investigación de
  mercado (Moises, Chordify, Ultimate Guitar, Songsterr, Jamzone, Chord ai…), los límites técnicos y
  legales de usar YouTube, y el roadmap.

## Proyecto: Sillage — Recomendador de perfumes

- [`sillage/`](sillage/README.md): app React Native (Expo) con tier gratuito y membresía PRO.
- [`functions/`](functions/): Cloud Functions (motor de matching, enriquecimiento GPT-4o, rate limiting, webhook RevenueCat).
- [`sillage-db-tools/`](sillage-db-tools/README.md): scripts Python de scraping, normalización y carga de la base de perfumes (pensado como repositorio separado).
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`: configuración de Firebase.

Setup completo en [`sillage/README.md`](sillage/README.md).