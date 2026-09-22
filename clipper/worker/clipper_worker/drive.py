"""Google Drive: descarga y subida con el refresh token guardado en settings."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests

from . import db
from .config import config
from .errors import UserError
from .log import get_logger

log = get_logger(__name__)

DRIVE_ID_PATTERNS = [
    re.compile(r"/file/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"[?&]id=([A-Za-z0-9_-]{10,})"),
    re.compile(r"/open\?id=([A-Za-z0-9_-]{10,})"),
    re.compile(r"^([A-Za-z0-9_-]{20,})$"),
]


def parse_drive_id(url_or_id: str) -> str | None:
    text = (url_or_id or "").strip()
    for pat in DRIVE_ID_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    return None


def _access_token() -> str | None:
    tokens = db.get_setting("google_tokens")
    if not tokens or not tokens.get("refresh_token"):
        return None
    if tokens.get("access_token") and tokens.get("expires_at", 0) > time.time() + 60:
        return tokens["access_token"]
    if not (config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET):
        raise UserError("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el worker para usar Google Drive.")
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": config.GOOGLE_CLIENT_ID,
            "client_secret": config.GOOGLE_CLIENT_SECRET,
            "refresh_token": tokens["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise UserError(
            "No se pudo renovar el acceso a Google Drive. Volvé a conectar tu cuenta en Configuración."
        )
    data = resp.json()
    tokens["access_token"] = data["access_token"]
    tokens["expires_at"] = time.time() + int(data.get("expires_in", 3600))
    db.set_setting("google_tokens", tokens)
    return tokens["access_token"]


def _meta(file_id: str, token: str | None) -> dict | None:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        params={"fields": "id,name,mimeType,size", "supportsAllDrives": "true"},
        headers=headers, timeout=30,
    )
    if resp.status_code == 200:
        return resp.json()
    return None


def download(file_id: str, dst_dir: Path, progress=None) -> tuple[Path, str]:
    """Descarga un archivo de Drive. Devuelve (ruta local, nombre)."""
    token = _access_token()
    meta = _meta(file_id, token)
    if meta is None and token:
        # Puede ser un archivo compartido por link al que la cuenta no tiene acceso directo.
        meta = _meta(file_id, None)
    if meta is None:
        if not token:
            raise UserError(
                "No se pudo acceder al archivo de Drive. Conectá tu cuenta de Google en Configuración "
                "y elegilo con el selector, o compartilo como 'cualquiera con el link'."
            )
        raise UserError(
            "No encontré ese archivo en Drive con tu cuenta. Elegilo con el selector de Drive "
            "(la app solo puede leer los archivos que elegís ahí) o compartilo como 'cualquiera con el link'."
        )
    name = meta.get("name") or file_id
    mime = meta.get("mimeType", "")
    if mime.startswith("application/vnd.google-apps"):
        raise UserError("El archivo elegido es un documento de Google, no un video ni audio.")
    if not re.search(r"\.(mp4|mov|m4a|mp3|mkv|webm|m4v|aac|wav)$", name, re.I) and not (
        mime.startswith("video/") or mime.startswith("audio/")
    ):
        raise UserError(f"El archivo '{name}' no parece ser un video ni un audio (mp4, mov, m4a, mp3).")

    dst_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.-]+", "_", name)[:120]
    dst = dst_dir / safe
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        params={"alt": "media", "supportsAllDrives": "true", "acknowledgeAbuse": "true"},
        headers=headers, stream=True, timeout=600,
    ) as resp:
        if resp.status_code in (401, 403):
            raise UserError("Drive no permitió descargar el archivo. Elegilo con el selector de Drive para darle permiso a la app.")
        if resp.status_code >= 400:
            raise UserError(f"Drive respondió {resp.status_code} al descargar el archivo.")
        total = int(resp.headers.get("Content-Length") or meta.get("size") or 0)
        done = 0
        with open(dst, "wb") as f:
            for chunk in resp.iter_content(4 * 1024 * 1024):
                f.write(chunk)
                done += len(chunk)
                if progress and total:
                    progress(done / total)
    return dst, name


def upload(local: Path, name: str, folder_id: str | None) -> dict:
    """Sube un archivo a Drive (multipart) y devuelve {id, webViewLink}."""
    token = _access_token()
    if not token:
        raise UserError("Conectá tu cuenta de Google en Configuración para guardar clips en Drive.")
    metadata = {"name": name}
    if folder_id:
        metadata["parents"] = [folder_id]
    with open(local, "rb") as f:
        files = {
            "metadata": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
            "file": (name, f, "video/mp4"),
        }
        resp = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files",
            params={"uploadType": "multipart", "fields": "id,webViewLink", "supportsAllDrives": "true"},
            headers={"Authorization": f"Bearer {token}"},
            files=files, timeout=1800,
        )
    if resp.status_code == 404 and folder_id:
        raise UserError("No encontré la carpeta de Drive configurada. Revisá el ID de carpeta en Configuración.")
    if resp.status_code >= 400:
        raise UserError(f"Drive rechazó la subida ({resp.status_code}): {resp.text[:200]}")
    return resp.json()
