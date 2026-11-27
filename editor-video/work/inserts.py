"""Cut close-ups / inserts into the PICTURE of the source (the voice is untouched), before build_project + make.sh.
usage: inserts.py <inserts.json>      inserts.json = [[clip_path, src_start_s, src_end_s], ...]  (source seconds; keep each range inside one EDL segment)
Keeps the original as dl/src/raw_plain.mov, writes dl/src/raw.mov, and drops cached mattes of the replaced frames."""
import os, sys, json, glob, re, subprocess
S = os.environ.get("VIDEO_EDIT_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
ins = [(c, round(a * FPS) / FPS, round(b * FPS) / FPS) for c, a, b in json.load(open(sys.argv[1]))]
raw, plain = f"{S}/dl/src/raw.mov", f"{S}/dl/src/raw_plain.mov"
if not os.path.exists(plain): os.rename(raw, plain)
cmd = ["ffmpeg", "-v", "error", "-y", "-i", plain]
for c, _, _ in ins: cmd += ["-i", c]
fc, last = "", "0:v"
for k, (_, a, b) in enumerate(ins):
    fc += (f"[{k + 1}:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps={FPS},trim=duration={b - a:.4f},setpts=PTS-STARTPTS+{a:.4f}/TB[i{k}];"
           f"[{last}][i{k}]overlay=enable='between(t,{a:.4f},{b - 0.001:.4f})':eof_action=pass[v{k}];")
    last = f"v{k}"
cmd += ["-filter_complex", fc.rstrip(";"), "-map", f"[{last}]", "-map", "0:a", "-c:v", "libx264", "-crf", "14", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "15", "-c:a", "copy", raw]
subprocess.run(cmd, check=True)
n = 0
for p in glob.glob(f"{S}/build/matte_cache/*.png"):
    m = re.search(r"(\d+)\.png$", p)
    if m and any(int(a * FPS) - 1 <= int(m.group(1)) <= int(b * FPS) + 1 for _, a, b in ins): os.remove(p); n += 1
print(f"{len(ins)} inserts, {n} cached mattes dropped")
