"""Material para terminar la edición a mano en CapCut (u otro editor): subtítulos .srt con los tiempos del video editado.
uso: export_capcut.py <proyecto> <salida.srt>
El video "limpio" (cortes + color + sonido, sin gráficos) sale de:  render.py <proyecto>/project.json limpio.mp4 --no-overlay
"""
import sys, json
P = json.load(open(sys.argv[1].rstrip("/") + "/project.json"))
def ts(t):
    t = max(0.0, t); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"
with open(sys.argv[2], "w", encoding="utf-8") as f:
    for n, c in enumerate(P["captions"], 1):
        f.write(f"{n}\n{ts(c['t0'])} --> {ts(c['t1'])}\n{c['text']}\n\n")
print(len(P["captions"]), "subtítulos")
