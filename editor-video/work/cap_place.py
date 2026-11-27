"""Where the captions may sit without covering what he is showing (a bottle, a box held up to the camera).
usage: cap_place.py <edl.json> <out.json> [--hflip] [--cx 540] [--half 330]
For every 0.1 s of the edit: a small map (8 px cells) of "something is here": colour/luma edges (spread a little, so a labelled
bottle counts as a whole) + how far the picture is from what is usually there. Mirrored like the picture when --hflip.
build_project.py reads it (--set capfree=<file>) and moves each run of caption cards to the clearest of a few fixed heights."""
import os, sys, json, subprocess, argparse
import numpy as np, cv2
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument("edl"); ap.add_argument("out"); ap.add_argument("--hflip", action="store_true"); ap.add_argument("--cx", type=int, default=540)
A = ap.parse_args(); E = json.load(open(A.edl)); FPS = 30; STEP = 0.1; W, H = 135, 240; K = 1080 / W
fin = [int(round(s["in"] * FPS)) for s in E["segments"]]; facc = [0]
for s in E["segments"]: facc.append(facc[-1] + int(round((s["out"] - s["in"]) * FPS)))
def src_frame(k):
    i = min(len(fin) - 1, max(0, int(np.searchsorted(facc, k, side="right") - 1))); return fin[i] + (k - facc[i])
times = [round(n * STEP, 3) for n in range(int(facc[-1] / FPS / STEP))]
need = {}
for t in times: need.setdefault(src_frame(int(round(t * FPS))), []).append(t)
dec = subprocess.Popen(["ffmpeg", "-v", "fatal", "-i", f"{S}/dl/src/raw.mov", "-an", "-vf", f"scale={W}:{H}:flags=area" + (",hflip" if A.hflip else ""), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
frames = {}; k = -1; last = max(need)
while k < last:
    buf = dec.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    k += 1
    if k in need: frames[k] = cv2.cvtColor(np.frombuffer(buf, np.uint8).reshape(H, W, 3), cv2.COLOR_BGR2LAB).astype(np.float32)
dec.kill()
ks = sorted(frames); stack = np.stack([frames[f] for f in ks]); med = np.median(stack[::max(1, len(ks) // 300)], axis=0)
dev = np.linalg.norm(stack - med[None], axis=3)                                           # (n, H, W): distance from the usual picture
def edges(f):
    e = sum(np.abs(cv2.Sobel(f[:, :, c], cv2.CV_32F, 1, 0)) + np.abs(cv2.Sobel(f[:, :, c], cv2.CV_32F, 0, 1)) for c in range(3))
    return cv2.blur(e, (5, 5))                                                              # spread: the inside of a labelled bottle counts, a single table edge does not
edge = np.stack([edges(f) for f in stack])
ch = stack[::max(1, len(ks) // 300), 125:188, 25:110].reshape(-1, 3); shirt = np.median(ch, axis=0)      # chest area over the whole video: his shirt dominates
far = np.linalg.norm(stack - shirt[None, None, None], axis=3)                               # not the shirt = a product, a hand, the table
cost = edge / (np.median(edge) + 1e-6) + 0.5 * dev / (np.median(dev) + 1e-6) + 0.8 * far / (np.percentile(far[:, 125:188, 25:110], 75) + 1e-6)
Y0, Y1 = 100, 215                                                                          # rows 800..1720 px: everywhere a caption could go
q = np.clip(cost[:, Y0:Y1] * 12, 0, 255).astype(np.uint8)
order = {}
for n, f in enumerate(ks):
    for t in need[f]: order[t] = n
ts_ = sorted(order)
np.save(A.out.replace(".json", ".npy"), q[[order[t] for t in ts_]])
json.dump({"step": STEP, "px": K, "y0": Y0, "scale": 12, "n": len(ts_), "npy": os.path.basename(A.out).replace(".json", ".npy"), "cx": A.cx}, open(A.out, "w"))
print("cap_place samples", len(ts_))
