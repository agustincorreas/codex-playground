"""Person-silhouette profile over the edited timeline (no zoom): per sampled time, the right-most and left-most matte x per 20-px row.
usage: silhouette.py <edl.json> <out.json> [step_s=0.2]"""
import os
import sys, json, subprocess, math
import numpy as np, cv2, onnxruntime as ort
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # working folder (holds work/, build/, analysis/, assets/, dl/, models/)
E = json.load(open(sys.argv[1])); step = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
segs = E["segments"]; FPS = 30; W, H = 1080, 1920
acc = [0.0]
for s in segs: acc.append(acc[-1] + s["out"] - s["in"])
def src_frame(t):
    i = min(len(segs) - 1, max(0, int(np.searchsorted(acc, t, side="right") - 1)))
    return int(math.floor((segs[i]["in"] + (t - acc[i])) * FPS + 1e-6))
times = [round(k * step, 3) for k in range(int(acc[-1] / step) + 1)]
need = {}
for t in times: need.setdefault(src_frame(min(t, acc[-1] - 0.02)), []).append(t)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sess = ort.InferenceSession(f"{S}/models/rvm/rvm_resnet50_fp32.onnx", so, providers=["CPUExecutionProvider"])
dec = subprocess.Popen(["ffmpeg", "-v", "fatal", "-i", f"{S}/dl/src/raw.mov", "-an", "-vf", "scale=540:960:in_color_matrix=bt709:in_range=tv:out_range=pc:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-vsync", "0", "-"], stdout=subprocess.PIPE, bufsize=540 * 960 * 3 * 8)
out = []; k = -1; last = max(need)
rows = list(range(200, 1920, 20))
while k < last:
    buf = dec.stdout.read(540 * 960 * 3)
    if len(buf) < 540 * 960 * 3: break
    k += 1
    if k not in need: continue
    fr = np.frombuffer(buf, np.uint8).reshape(960, 540, 3)
    src = (fr.astype(np.float32) / 255).transpose(2, 0, 1)[None]
    rec = [np.zeros([1, 1, 1, 1], np.float32)] * 4      # independent stills: no temporal state
    fgr, pha, *_ = sess.run([], {"src": src, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": np.array([0.5], np.float32)})
    m = pha[0, 0] > 0.5
    right = []; left = []
    for y in rows:
        band = m[y // 2: y // 2 + 10].any(0); xs = np.where(band)[0]
        right.append(int(xs.max() * 2) if len(xs) else -1); left.append(int(xs.min() * 2) if len(xs) else -1)
    for t in need[k]: out.append({"t": t, "right": right, "left": left})
dec.kill()
out.sort(key=lambda o: o["t"])
json.dump({"rows": rows, "samples": out}, open(sys.argv[2], "w"))
print("samples", len(out))
