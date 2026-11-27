"""Frame-accurate compositor: source video (EDL cuts + animated zoom + grade) + RGBA overlay frames + final audio -> mp4.

usage: render.py <project.json> <out.mp4> [--t0 SEC --t1 SEC] [--scale 0.5] [--crf N] [--preset P] [--no-overlay] [--stills DIR t1,t2,...]

project.json:
  src, fps, w, h
  segments: [{in, out}]  kept source spans in seconds (same list the audio builder uses)
  grade: ffmpeg filter chain applied on decode (optional)
  zoom: keyframes over OUTPUT time [{t, s, cx, cy, ease}] ; s>=1, (cx,cy) = source pixel kept at frame centre.
        ease on a keyframe describes how we ARRIVE at it from the previous one: 'cut' (hold previous, jump at t), 'linear', 'inout', 'out'.
  overlay_dir: directory with manifest.json + RGBA PNGs (optional)
  audio: wav to mux (optional)
"""
import sys, json, subprocess, os, math, argparse
import numpy as np, cv2

ap = argparse.ArgumentParser()
ap.add_argument("project"); ap.add_argument("out")
ap.add_argument("--t0", type=float, default=0.0); ap.add_argument("--t1", type=float, default=None)
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--crf", type=int, default=16); ap.add_argument("--preset", default="slow")
ap.add_argument("--no-overlay", action="store_true")
ap.add_argument("--stills", nargs=2, default=None, help="DIR and comma separated output times: write JPG stills instead of a video")
a = ap.parse_args()

P = json.load(open(a.project))
W, H, FPS = P["w"], P["h"], P["fps"]
segs = P["segments"]
acc = [0.0]
for s in segs: acc.append(acc[-1] + (s["out"] - s["in"]))
total = acc[-1]
FRZ = P.get("freeze")                       # {"at": edit time where the picture holds, "dim": 0..1}
N = int(round(P.get("duration", total) * FPS)) if FRZ else int(round(total * FPS))

_fin = [int(round(s_["in"] * FPS)) for s_ in segs]            # whole frames: the EDL stores seconds rounded to 4 decimals, so never floor them
_facc = [0]
for s_ in segs: _facc.append(_facc[-1] + int(round((s_["out"] - s_["in"]) * FPS)))
def src_frame_for(k):
    i = min(len(segs) - 1, max(0, int(np.searchsorted(_facc, k, side="right") - 1)))
    return _fin[i] + (k - _facc[i])

src_idx = [src_frame_for(min(k, int(round(FRZ["at"] * FPS))) if FRZ else k) for k in range(N)]

EASE = {
    "linear": lambda u: u,
    "inout": lambda u: u * u * (3 - 2 * u),
    "out": lambda u: 1 - (1 - u) ** 3,
    "in": lambda u: u ** 3,
}
kf = sorted(P.get("zoom") or [{"t": 0, "s": 1.0}], key=lambda z: z["t"])
for z in kf:
    z.setdefault("ax", W / 2); z.setdefault("ay", H / 2)
def _centre(s, ax, ay):
    # zoom about an anchor: the anchor pixel keeps its screen position while the picture scales around it
    return ax + (W / 2 - ax) / s, ay + (H / 2 - ay) / s
def zoom_at(t):
    if t <= kf[0]["t"]:
        z = kf[0]; return (z["s"],) + _centre(z["s"], z["ax"], z["ay"])
    for i in range(1, len(kf)):
        if t < kf[i]["t"]:
            p, q = kf[i - 1], kf[i]
            e = q.get("ease", "cut")
            if e == "cut": return (p["s"],) + _centre(p["s"], p["ax"], p["ay"])
            u = EASE[e]((t - p["t"]) / max(1e-9, q["t"] - p["t"]))
            s = math.exp(math.log(p["s"]) + (math.log(q["s"]) - math.log(p["s"])) * u)   # geometric interpolation: constant-speed push
            return (s,) + _centre(s, p["ax"] + (q["ax"] - p["ax"]) * u, p["ay"] + (q["ay"] - p["ay"]) * u)
    z = kf[-1]; return (z["s"],) + _centre(z["s"], z["ax"], z["ay"])

def affine(s, cx, cy):
    # keep the crop window inside the frame
    hw, hh = W / (2 * s), H / (2 * s)
    cx = min(max(cx, hw), W - hw); cy = min(max(cy, hh), H - hh)
    return np.array([[s, 0, W / 2 - s * cx], [0, s, H / 2 - s * cy]], dtype=np.float64)

ovdir = None if a.no_overlay else P.get("overlay_dir")
manifest = None
if ovdir and os.path.exists(os.path.join(ovdir, "manifest.json")):
    manifest = json.load(open(os.path.join(ovdir, "manifest.json")))
bkdir = None if a.no_overlay else P.get("overlay_back_dir")
manifest_b = None
if bkdir and os.path.exists(os.path.join(bkdir, "manifest.json")):
    manifest_b = json.load(open(os.path.join(bkdir, "manifest.json")))
_cache = {"f": None, "img": None}
_cache_b = {"f": None, "img": None}
def overlay_for(k, manifest=None, ovdir=None, _cache=None):
    manifest = manifest if manifest is not None else globals()["manifest"]; ovdir = ovdir or globals()["ovdir"]; _cache = _cache if _cache is not None else globals()["_cache"]
    if not manifest or k >= len(manifest) or manifest[k] is None: return None
    f = manifest[k]
    if _cache["f"] != f:
        im = cv2.imread(os.path.join(ovdir, f), cv2.IMREAD_UNCHANGED)
        al = im[:, :, 3]
        ys, xs = np.where(al > 0)
        if len(ys) == 0: _cache.update(f=f, img=None)
        else:
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            _cache.update(f=f, img=(y0, y1, x0, x1, im[y0:y1, x0:x1, :3].astype(np.uint16), al[y0:y1, x0:x1].astype(np.uint16)[:, :, None]))
    return _cache["img"]

# ---- person matte (Robust Video Matting) so "back" overlays sit behind the speaker
_rvm = {"sess": None, "rec": None, "last": -99}
MATTE_W, MATTE_H = 540, 960
def has_back(k): return bool(manifest_b) and 0 <= k < len(manifest_b) and manifest_b[k] is not None
MCACHE = P.get("matte_cache") or os.path.join(os.path.dirname(os.path.abspath(a.project)), "matte_cache")
def matte_src(frame, k):
    """Alpha matte (uint8, half-res) of the speaker for the un-zoomed source frame shown at output frame k; cached per source frame."""
    f = src_idx[k]
    fn = os.path.join(MCACHE, f"m_{f:06d}.png")
    if os.path.exists(fn):
        m = cv2.imread(fn, cv2.IMREAD_GRAYSCALE)
        if m is not None: return m
    import onnxruntime as ort
    if _rvm["sess"] is None:
        os.makedirs(MCACHE, exist_ok=True)
        so = ort.SessionOptions(); so.intra_op_num_threads = 4
        _rvm["sess"] = ort.InferenceSession(P.get("matte_model", ((os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) + "/models/rvm/rvm_resnet50_fp32.onnx")), so, providers=["CPUExecutionProvider"])
    if _rvm["rec"] is None or f != _rvm["last"] + 1:
        _rvm["rec"] = [np.zeros([1, 1, 1, 1], np.float32)] * 4      # reset temporal state on any discontinuity (cuts included)
    small = cv2.resize(frame, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
    src = (small[:, :, ::-1].astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    r = _rvm["rec"]
    fgr, pha, *rec = _rvm["sess"].run([], {"src": src, "r1i": r[0], "r2i": r[1], "r3i": r[2], "r4i": r[3], "downsample_ratio": np.array([0.5], np.float32)})
    _rvm["rec"] = rec; _rvm["last"] = f
    m = np.clip(pha[0, 0] * 255 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(fn, m)
    return m

OCC = {}     # output frame -> share of the back-layer card pixels hidden by the speaker (for the automatic QA)
def compose(frame, k):
    s, cx, cy = zoom_at(k / FPS)
    zoomed = abs(s - 1.0) > 1e-4 or abs(cx - W / 2) > 0.01 or abs(cy - H / 2) > 0.01
    need_m = bool(manifest_b) and (has_back(k) or any(has_back(k + j) for j in range(1, 9)))
    msmall = matte_src(frame, k) if need_m else None                 # on the un-zoomed frame (also a few frames ahead, to warm the temporal state)
    if zoomed:
        frame = cv2.warpAffine(frame, affine(s, cx, cy), (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    amt = P.get("sharpen", 0.0) * (1.5 if s > 1.04 else 1.0)       # a little more on punch-ins (the picture is scaled up there)
    if amt > 0:
        blur = cv2.GaussianBlur(frame, (5, 5), 1.0)
        frame = cv2.addWeighted(frame, 1 + amt, blur, -amt, 0)
    if need_m:
        ob = overlay_for(k, manifest_b, bkdir, _cache_b)
        if ob is not None:
            m = cv2.resize(msmall, (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
            if zoomed: m = cv2.warpAffine(m, affine(s, cx, cy), (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            y0, y1, x0, x1, rgb, al = ob
            vis = (al[:, :, 0].astype(np.float32) / 255.0) * (1.0 - m[y0:y1, x0:x1])
            solid = al[:, :, 0] > 128
            if solid.sum() > 400: OCC[k] = round(float(m[y0:y1, x0:x1][solid].mean()), 3)
            reg = frame[y0:y1, x0:x1].astype(np.float32)
            frame = frame.copy()
            frame[y0:y1, x0:x1] = np.clip(reg * (1 - vis[:, :, None]) + rgb.astype(np.float32) * vis[:, :, None] + 0.5, 0, 255).astype(np.uint8)
    if FRZ and k / FPS > FRZ["at"]:
        u = min(1.0, (k / FPS - FRZ["at"]) / 0.5)
        frame = cv2.convertScaleAbs(frame, alpha=1.0 - FRZ.get("dim", 0.15) * u * u * (3 - 2 * u), beta=0)   # reads as a deliberate end plate
    ov = overlay_for(k)
    if ov is not None:
        y0, y1, x0, x1, rgb, al = ov
        reg = frame[y0:y1, x0:x1].astype(np.uint16)
        frame = frame.copy() if not frame.flags.writeable else frame
        frame[y0:y1, x0:x1] = ((reg * (255 - al) + rgb * al + 127) // 255).astype(np.uint8)
    return frame

k0 = max(0, int(round(a.t0 * FPS))); k1 = N if a.t1 is None else min(N, int(round(a.t1 * FPS)))
still_ks = None
if a.stills:
    os.makedirs(a.stills[0], exist_ok=True)
    still_ks = sorted({min(N - 1, max(0, int(round(float(t) * FPS)))) for t in a.stills[1].split(",")})
    k0, k1 = still_ks[0], still_ks[-1] + 1

first_src = src_idx[k0]
grade = P.get("grade") or "null"
seek_frame = max(0, first_src - FPS)
dec = ["ffmpeg", "-v", "fatal"] + (["-ss", f"{(seek_frame - 0.5) / FPS:.6f}"] if seek_frame > 0 else []) + ["-i", P["src"], "-an",
       "-vf", f"scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=bicubic,format=gbrp,{'hflip,' if P.get('hflip') else ''}{grade},format=bgr24",
       "-f", "rawvideo", "-pix_fmt", "bgr24", "-vsync", "0", "-"]
pd = subprocess.Popen(dec, stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)

enc = None
if not still_ks:
    ow, oh = int(W * a.scale) // 2 * 2, int(H * a.scale) // 2 * 2
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    aud = P.get("audio")
    if aud and os.path.exists(aud):
        cmd += ["-ss", f"{k0 / FPS:.6f}", "-t", f"{(k1 - k0) / FPS:.6f}", "-i", aud]
    vf = f"scale={ow}:{oh}:flags=lanczos:in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p"
    cmd += ["-vf", vf, "-c:v", "libx264", "-preset", a.preset, "-crf", str(a.crf), "-profile:v", "high", "-level", "4.2",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
            "-x264-params", "keyint=60:min-keyint=30:bframes=3"]
    if aud and os.path.exists(aud): cmd += ["-c:a", "aac", "-b:a", "256k", "-ar", "48000"]
    cmd += ["-movflags", "+faststart", "-shortest", a.out]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

fsz = W * H * 3
class Reader:
    """Sequential source-frame access with a one-frame look-ahead (needed to repair the exporter's periodic chroma glitch)."""
    def __init__(self, first): self.idx = first - 1; self.buf = {}
    def _read(self):
        b = pd.stdout.read(fsz)
        if len(b) < fsz: return False
        self.idx += 1; self.buf[self.idx] = np.frombuffer(b, np.uint8).reshape(H, W, 3)
        for old in [i for i in self.buf if i < self.idx - 3]: del self.buf[old]
        return True
    def get(self, f):
        while self.idx < f:
            if not self._read(): break
        return self.buf.get(f)
    def peek(self, f):
        while self.idx < f:
            if not self._read(): return None
        return self.buf.get(f)
rd = Reader(seek_frame)
DEFECT = int(P.get("chroma_defect_period", 0))
def fixed_frame(f):
    fr = rd.get(f)
    if fr is None: return None
    if DEFECT and f > 0 and f % DEFECT == 0:
        prev = rd.buf.get(f - 1); nxt = rd.peek(f + 1); fr = rd.buf.get(f)
        if prev is not None and nxt is not None:
            ycc = [cv2.cvtColor(x, cv2.COLOR_BGR2YCrCb) for x in (prev, fr, nxt)]
            cb = np.median(np.stack([y[:, :, 2] for y in ycc]), axis=0).astype(np.uint8)   # 3-frame temporal median of Cb only
            out = ycc[1].copy(); out[:, :, 2] = cb
            fr = cv2.cvtColor(out, cv2.COLOR_YCrCb2BGR)
    return fr
last_f = None; frame = None
for k in range(k0, k1):
    need = src_idx[k]
    if still_ks is not None and k not in still_ks:
        continue
    if need != last_f:
        if DEFECT and need % DEFECT == 0 and need > 0: rd.get(need - 1)       # make sure the previous frame is buffered
        frame = fixed_frame(need); last_f = need
    if frame is None: raise SystemExit(f"decode ended early at output frame {k} (need src {need}, at {rd.idx})")
    out = compose(frame, k)
    if still_ks is not None:
        cv2.imwrite(os.path.join(a.stills[0], f"still_{k / FPS:07.2f}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 92])
    else:
        enc.stdin.write(np.ascontiguousarray(out).tobytes())
    if (k - k0) % 300 == 0: print(f"  frame {k - k0}/{k1 - k0}", flush=True)
pd.kill()
if enc:
    enc.stdin.close(); enc.wait()
if enc and OCC: json.dump({str(k): v for k, v in sorted(OCC.items())}, open(os.path.splitext(a.out)[0] + ".occlusion.json", "w"))
print("done", a.out, "frames", k1 - k0, "duration", (k1 - k0) / FPS)
