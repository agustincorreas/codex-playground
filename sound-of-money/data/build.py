#!/usr/bin/env python3
"""Convierte los CSV crudos de `raw/` (velas intradía de Massive, hora regular 9:30-16:00 ET)
en `dias.js`, el archivo que la app carga sin dependencias.

Formato de cada CSV: m,o,h,l,c,v  (m = minuto desde la apertura; v en miles de acciones).
Nombre del archivo: <DIA>_<SIMBOLO>.csv donde DIA es la letra del día (ver DIAS abajo).
"""
import csv
import json
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(AQUI, 'raw')

DIAS = {
    'A': {
        'fecha': '2026-09-21',
        'titulo': 'Lunes 21 de septiembre de 2026',
        'resumen': 'Día de subida: el S&P 500 abre plano y trepa toda la tarde (+0,9 %). META vuela 9 % '
                   'tras una noticia, MRNA +7 %, y dos micro caps (VRME, GRML) se disparan con volumen enorme.',
        'solista': 'META',
    },
    'B': {
        'fecha': '2026-10-30',
        'titulo': 'Viernes 30 de octubre de 2026',
        'resumen': 'Día de caída con volumen alto: el S&P 500 baja casi todo el día (-0,7 %) y rebota en el cierre. '
                   'AMZN +3,4 % contra la corriente, PLTR -4,9 %, JPM -2,4 %; AIOK duplica y CLRO se desploma 32 %.',
        'solista': 'AMZN',
    },
}


def leer(path):
    with open(path, newline='') as f:
        filas = list(csv.reader(f))
    if filas and filas[0] and filas[0][0] == 'm':
        filas = filas[1:]
    out = []
    for fila in filas:
        if len(fila) != 6:
            raise SystemExit(f'{path}: fila rara {fila}')
        m, o, h, l, c, v = fila
        o, h, l, c = (float(x) for x in (o, h, l, c))
        # saneo: el máximo/mínimo tienen que contener apertura y cierre
        h = max(h, o, c)
        l = min(l, o, c)
        out.append([int(m), o, h, l, c, float(v)])
    out.sort(key=lambda r: r[0])
    return out


def main():
    dias = {}
    for letra, meta in DIAS.items():
        series = {}
        for nombre in sorted(os.listdir(RAW)):
            if not nombre.startswith(letra + '_') or not nombre.endswith('.csv'):
                continue
            sym = nombre[2:-4]
            bars = leer(os.path.join(RAW, nombre))
            # timeframe en minutos: el salto más común entre velas
            saltos = [b[0] - a[0] for a, b in zip(bars, bars[1:])]
            tf = max(set(saltos), key=saltos.count) if saltos else 1
            series[sym] = {'tf': tf, 'bars': bars}
        if 'SPY' not in series:
            raise SystemExit(f'día {letra}: falta SPY')
        dias[meta['fecha']] = {
            'titulo': meta['titulo'],
            'resumen': meta['resumen'],
            'solista': meta['solista'],
            'series': series,
        }
        print(f"{meta['fecha']}: {', '.join(f'{s} ({v['tf']}m, {len(v['bars'])})' for s, v in series.items())}")

    js = json.dumps(dias, separators=(',', ':'), ensure_ascii=False)
    with open(os.path.join(AQUI, 'dias.js'), 'w') as f:
        f.write('// Generado por data/build.py a partir de data/raw/*.csv (datos reales de Massive).\n')
        f.write('// Velas de la sesión regular (9:30-16:00 ET): [minuto, apertura, máximo, mínimo, cierre, volumen en miles].\n')
        f.write('window.CAMPANA_DIAS = ' + js + ';\n')
    print('escrito dias.js', os.path.getsize(os.path.join(AQUI, 'dias.js')), 'bytes')


if __name__ == '__main__':
    main()
