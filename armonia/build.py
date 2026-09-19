#!/usr/bin/env python3
"""Genera armonia.html: versión de un solo archivo (HTML + CSS + JS) para abrir con doble clic."""
import pathlib
here = pathlib.Path(__file__).parent
html = (here / 'index.html').read_text()
body = html.split('<!--ARTIFACT-START-->')[1].split('<!--ARTIFACT-END-->')[0]
css = (here / 'style.css').read_text()
js = '\n'.join((here / f).read_text() for f in ['theory.js', 'sounds.js', 'audio.js', 'app.js'])
head = html.split('<head>')[1].split('<link rel="stylesheet" href="style.css">')[0]
page = f"<!doctype html>\n<html lang=\"es\">\n<head>{head}<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n<script>\n{js}\n</script>\n</body>\n</html>\n"
(here / 'armonia.html').write_text(page)
print('armonia.html', len(page), 'bytes')
# versión para celulares: fuerza el layout táctil aunque el navegador reporte una pantalla ancha
movil = page.replace('<body>', '<body class="mobile force-mobile">')
(here / 'armonia-movil.html').write_text(movil)
print('armonia-movil.html', len(movil), 'bytes')
