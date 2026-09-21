#!/usr/bin/env python3
"""Genera ensayo/catalog.js a partir de ensayo/data/.

- catalog-part*.json: temas (tonalidad, BPM, acordes por sección, bases de YouTube).
- catalog-extra.json: bases de YouTube adicionales por tema e instrumento
  ({ "<id>": { "guitarra": "<videoId>", ... } }) que pisan/completan las anteriores.
Uso: python3 ensayo/scripts/build-catalog.py
"""
import glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
SKIP = {'adios-sui-generis'}  # es un disco, no un tema

songs, seen = [], set()
for f in sorted(glob.glob(os.path.join(DATA, 'catalog-part*.json'))):
    for s in json.load(open(f, encoding='utf-8')):
        if not s.get('title') or s['id'] in seen or s['id'] in SKIP:
            continue
        seen.add(s['id'])
        yt = {k: v for k, v in (s.get('yt') or {}).items() if isinstance(v, str) and re.fullmatch(r'[\w-]{11}', v)}
        songs.append({'id': s['id'], 'title': s['title'], 'artist': s.get('artist', ''), 'key': s.get('key', ''),
                      'bpm': s.get('bpm'), 'beats': s.get('beats', 4), 'tags': s.get('tags', []),
                      'sections': s.get('sections', []), 'chordsConfidence': s.get('chordsConfidence', 'low'), 'yt': yt})

extra_path = os.path.join(DATA, 'catalog-extra.json')
extra = json.load(open(extra_path, encoding='utf-8')) if os.path.exists(extra_path) else {}
for s in songs:
    for k, v in (extra.get(s['id']) or {}).items():
        if isinstance(v, str) and re.fullmatch(r'[\w-]{11}', v):
            s['yt'][k] = v

out = ('// catalog.js — catálogo precargado. GENERADO por scripts/build-catalog.py a partir de data/*.json; no editar a mano.\n'
       '// Cada tema: tonalidad, BPM, acordes básicos por sección y bases de YouTube por instrumento.\n'
       'window.Catalog = ' + json.dumps(songs, ensure_ascii=False, separators=(',', ':')) + ';\n')
open(os.path.join(ROOT, 'catalog.js'), 'w', encoding='utf-8').write(out)
n = len(songs)
cnt = lambda k: sum(1 for s in songs if k in s['yt'])
print(f"{n} temas · con alguna base: {sum(1 for s in songs if s['yt'])} · guitarra {cnt('guitarra')} · bajo {cnt('bajo')} · batería {cnt('bateria')} · voz {cnt('voz')} · teclado {cnt('teclado')}")
