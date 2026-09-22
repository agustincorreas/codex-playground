"""Obtención del video de origen: YouTube (yt-dlp), Google Drive o subida directa.

El archivo queda cacheado en WORK_DIR/sources/<video_id>/ para reusarlo al
renderizar. Si no está (reinicio del contenedor sin volumen) se vuelve a bajar.
"""
from __future__ import annotations

import re
import shutil
import time
from pathlib import Path
from typing import Callable

from . import db, drive, storage
from .config import config
from .errors import UserError
from .log import get_logger
from .media import duration_of, probe, video_stream

log = get_logger(__name__)

Progress = Callable[[str], None]

YOUTUBE_RE = re.compile(
    r"^(https?://)?(www\.|m\.|music\.)?(youtube\.com/(watch\?.*v=|live/|shorts/|embed/)|youtu\.be/)[\w-]{6,}",
    re.I,
)


def is_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_RE.match((url or "").strip()))


def source_dir(video_id: str) -> Path:
    d = config.WORK_DIR / "sources" / video_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def cached_source(video_id: str) -> Path | None:
    d = config.WORK_DIR / "sources" / video_id
    if not d.exists():
        return None
    for p in sorted(d.iterdir()):
        if p.is_file() and p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".m4v", ".wav", ".aac"):
            return p
    return None


def _cookies_file() -> Path | None:
    data = storage.download_bytes("settings/cookies.txt")
    if not data:
        return None
    p = config.WORK_DIR / "cookies.txt"
    p.write_bytes(data)
    return p


def _classify_ytdlp_error(msg: str) -> str:
    m = msg.lower()
    if "private video" in m:
        return "El video es privado. Cambialo a 'no listado' o 'público'."
    if "sign in to confirm your age" in m or "age-restricted" in m:
        return "El video tiene restricción de edad. Subí un archivo cookies.txt en Configuración."
    if "sign in to confirm you're not a bot" in m or "cookies" in m:
        return "YouTube pidió verificación (cookies). Subí un archivo cookies.txt en Configuración."
    if "video unavailable" in m or "this video is not available" in m:
        return "El video no está disponible (borrado, bloqueado por región o link incorrecto)."
    if "is not a valid url" in m or "unsupported url" in m:
        return "El link no es válido."
    if "members-only" in m or "join this channel" in m:
        return "El video es solo para miembros del canal. Subí un archivo cookies.txt en Configuración."
    if "is live" in m or "live event will begin" in m or "premieres in" in m:
        return "El video todavía está en vivo o es un estreno. Esperá a que termine y quede publicado."
    return "No se pudo descargar el video de YouTube: " + msg.strip().splitlines()[-1][:200]


def download_youtube(url: str, dst_dir: Path, progress: Progress | None = None) -> tuple[Path, str]:
    import yt_dlp

    if not is_youtube_url(url):
        raise UserError("El link no parece ser de YouTube.")
    cookies = _cookies_file()
    last_report = {"t": 0.0}

    def hook(d):
        if d.get("status") == "downloading" and progress:
            now = time.time()
            if now - last_report["t"] > 2:
                last_report["t"] = now
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                pct = f" {done * 100 / total:.0f}%" if total else ""
                progress(f"Descargando de YouTube{pct}")

    h = config.YTDLP_MAX_HEIGHT
    opts = {
        "format": f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={h}]+bestaudio/best[height<={h}]/best",
        "merge_output_format": "mp4",
        "outtmpl": str(dst_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
        "retries": 5,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
    }
    if cookies:
        opts["cookiefile"] = str(cookies)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as e:
        raise UserError(_classify_ytdlp_error(str(e))) from e
    if info.get("is_live"):
        raise UserError("El video está en vivo ahora. Esperá a que termine y quede publicado.")
    title = info.get("title") or url
    path = cached_source(dst_dir.name)
    if not path:
        raise UserError("yt-dlp terminó pero no encontré el archivo descargado.")
    return path, title


def download_upload(source_path: str, dst_dir: Path, progress: Progress | None = None) -> tuple[Path, str]:
    name = Path(source_path).name
    if progress:
        progress("Bajando el archivo subido")
    try:
        local = storage.download_file(source_path, dst_dir / re.sub(r"[^\w.-]+", "_", name))
    except FileNotFoundError:
        raise UserError("No encontré el archivo subido en Storage. Volvé a subirlo.")
    return local, name


def acquire(video: dict, progress: Progress | None = None) -> tuple[Path, str | None]:
    """Devuelve (ruta local del video original, título). Usa el caché si existe."""
    video_id = str(video["id"])
    cached = cached_source(video_id)
    if cached:
        return cached, video.get("title")
    dst_dir = source_dir(video_id)
    kind = video["source_type"]
    if kind == "youtube":
        path, title = download_youtube(video["source_url"], dst_dir, progress)
    elif kind == "drive":
        file_id = video.get("source_file_id") or drive.parse_drive_id(video.get("source_url") or "")
        if not file_id:
            raise UserError("El link de Google Drive no es válido. Pegá el link 'Compartir' de un archivo o usá el selector.")
        if progress:
            progress("Descargando de Google Drive")
        path, title = drive.download(
            file_id, dst_dir,
            progress=lambda f: progress(f"Descargando de Google Drive {f * 100:.0f}%") if progress else None,
        )
    elif kind == "upload":
        if not video.get("source_path"):
            raise UserError("Falta el archivo subido.")
        path, title = download_upload(video["source_path"], dst_dir, progress)
    else:
        raise UserError(f"Tipo de origen desconocido: {kind}")

    info = probe(path)
    if video_stream(info) is None and path.suffix.lower() not in (".m4a", ".mp3", ".wav", ".aac"):
        raise UserError("El archivo no tiene pista de video.")
    dur = duration_of(path)
    if dur < 10:
        raise UserError("El video dura menos de 10 segundos; no hay nada para recortar.")
    return path, title


def prune_cache(keep_video_id: str | None = None) -> None:
    """Mantiene el caché de originales por debajo de SOURCE_CACHE_GB (borra los más viejos)."""
    root = config.WORK_DIR / "sources"
    if not root.exists():
        return
    dirs = [d for d in root.iterdir() if d.is_dir()]
    sizes = {d: sum(p.stat().st_size for p in d.rglob("*") if p.is_file()) for d in dirs}
    total = sum(sizes.values())
    limit = config.SOURCE_CACHE_GB * 1024 ** 3
    for d in sorted(dirs, key=lambda d: d.stat().st_mtime):
        if total <= limit:
            break
        if d.name == keep_video_id:
            continue
        shutil.rmtree(d, ignore_errors=True)
        total -= sizes[d]
        log.info("caché: borrado %s", d)


def delete_cache(video_id: str) -> None:
    shutil.rmtree(config.WORK_DIR / "sources" / video_id, ignore_errors=True)
