"""Render preview stills of a built project at given output times. usage: preview.py <projdir> <t1,t2,...> [cols]"""
import sys, json, subprocess, os, glob, shutil
import cv2, numpy as np
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
pd, times = os.path.abspath(sys.argv[1]), [float(x) for x in sys.argv[2].split(",")]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
P = json.load(open(f"{pd}/project.json")); fps = P["fps"]; N = int(round(P["duration"] * fps))
ks = sorted({min(N - 1, max(0, int(round(t * fps)))) for t in times})
tmp = f"{pd}/preview"; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
for layer in ("front", "back"):
    subprocess.run(["node", f"{S}/work/overlay_still.js", f"{pd}/overlay/index.html", f"{tmp}/ov_{layer}", str(N), str(fps), layer, ",".join(map(str, ks))], check=True, cwd=f"{S}/work")
P2 = dict(P); P2["overlay_dir"] = f"{tmp}/ov_front"; P2["overlay_back_dir"] = f"{tmp}/ov_back"
json.dump(P2, open(f"{tmp}/project.json", "w"))
subprocess.run(["python3", "-I", f"{S}/work/render.py", f"{tmp}/project.json", "x", "--stills", f"{tmp}/stills", ",".join(f"{k / fps:.4f}" for k in ks)], check=True)
fs = sorted(glob.glob(f"{tmp}/stills/*.jpg")); tiles = []
for f in fs:
    im = cv2.resize(cv2.imread(f), (405, 720), interpolation=cv2.INTER_AREA)
    lab = os.path.basename(f)[6:-4]
    cv2.putText(im, lab, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3); cv2.putText(im, lab, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    tiles.append(im)
while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
rows = [np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
for i, r in enumerate(rows): cv2.imwrite(f"{tmp}/sheet_{i}.jpg", r, [cv2.IMWRITE_JPEG_QUALITY, 88])
print("sheets:", len(rows), "stills:", len(fs))
