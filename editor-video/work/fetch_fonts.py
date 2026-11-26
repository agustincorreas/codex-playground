import re, subprocess, sys, os, hashlib
out = sys.argv[1]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
specs = [
 "Montserrat:ital,wght@0,400..900;1,400..900", "Manrope:wght@300..800", "Inter+Tight:ital,wght@0,300..900;1,300..900",
 "Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800", "DM+Sans:ital,opsz,wght@0,9..40,300..900;1,9..40,300..900",
 "Sora:wght@300..800", "Outfit:wght@300..900", "Poppins:ital,wght@0,500;0,600;0,700;0,800;1,600",
 "Instrument+Serif:ital@0;1", "Playfair+Display:ital,wght@0,400..900;1,400..900", "Cormorant+Garamond:ital,wght@0,300..700;1,300..700",
 "Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900", "Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900",
 "DM+Serif+Display:ital@0;1", "Italiana", "Cormorant:ital,wght@0,300..700;1,300..700", "Syne:wght@400..800", "Unbounded:wght@300..900",
]
css_all = []
for sp in specs:
    url = f"https://fonts.googleapis.com/css2?family={sp}&display=block"
    css = subprocess.run(["curl", "-sS", "--max-time", "30", "-A", UA, url], capture_output=True, text=True).stdout
    blocks = re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, flags=re.S)
    n = 0
    for subset, blk in blocks:
        if subset not in ("latin", "latin-ext"): continue
        m = re.search(r"url\((https://[^)]+\.woff2)\)", blk)
        if not m: continue
        u = m.group(1); fn = hashlib.md5(u.encode()).hexdigest()[:12] + ".woff2"
        if not os.path.exists(f"{out}/{fn}"):
            subprocess.run(["curl", "-sS", "--max-time", "60", "-o", f"{out}/{fn}", u], check=True)
        css_all.append(blk.replace(u, fn)); n += 1
    print(sp.split(":")[0], n, "faces" if n else "FAILED: " + css[:120].replace("\n", " "))
open(f"{out}/fonts.css", "w").write("\n".join(css_all))
