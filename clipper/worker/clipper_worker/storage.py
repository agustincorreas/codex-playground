"""Supabase Storage vía su API REST (sin SDK)."""
from __future__ import annotations

import mimetypes
from pathlib import Path

import requests

from .config import config
from .errors import RetryableError


def _headers(extra: dict | None = None) -> dict:
    h = {
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY or "",
    }
    if extra:
        h.update(extra)
    return h


def _object_url(path: str) -> str:
    return f"{config.SUPABASE_URL}/storage/v1/object/{config.STORAGE_BUCKET}/{path.lstrip('/')}"


def upload_file(local: Path, path: str, content_type: str | None = None) -> str:
    content_type = content_type or mimetypes.guess_type(str(local))[0] or "application/octet-stream"
    with open(local, "rb") as f:
        resp = requests.post(
            _object_url(path),
            headers=_headers({"Content-Type": content_type, "x-upsert": "true"}),
            data=f,
            timeout=600,
        )
    if resp.status_code >= 400:
        raise RetryableError(f"Error subiendo {path} a Storage: {resp.status_code} {resp.text[:300]}")
    return path


def download_file(path: str, local: Path) -> Path:
    local.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(_object_url(path), headers=_headers(), stream=True, timeout=600) as resp:
        if resp.status_code == 404 or resp.status_code == 400:
            raise FileNotFoundError(path)
        if resp.status_code >= 400:
            raise RetryableError(f"Error bajando {path} de Storage: {resp.status_code} {resp.text[:300]}")
        with open(local, "wb") as f:
            for chunk in resp.iter_content(1024 * 1024):
                f.write(chunk)
    return local


def download_bytes(path: str) -> bytes | None:
    resp = requests.get(_object_url(path), headers=_headers(), timeout=120)
    if resp.status_code in (400, 404):
        return None
    if resp.status_code >= 400:
        raise RetryableError(f"Error bajando {path} de Storage: {resp.status_code}")
    return resp.content


def delete_files(paths: list[str]) -> None:
    if not paths:
        return
    requests.delete(
        f"{config.SUPABASE_URL}/storage/v1/object/{config.STORAGE_BUCKET}",
        headers=_headers({"Content-Type": "application/json"}),
        json={"prefixes": paths},
        timeout=60,
    )


def list_files(prefix: str, limit: int = 200) -> list[dict]:
    """Lista objetos bajo un prefijo (carpeta). Devuelve [{"name", "metadata"...}] sin carpetas."""
    resp = requests.post(
        f"{config.SUPABASE_URL}/storage/v1/object/list/{config.STORAGE_BUCKET}",
        headers=_headers({"Content-Type": "application/json"}),
        json={"prefix": prefix.strip("/"), "limit": limit, "offset": 0, "sortBy": {"column": "name", "order": "asc"}},
        timeout=60,
    )
    if resp.status_code >= 400:
        raise RetryableError(f"Error listando {prefix} en Storage: {resp.status_code}")
    return [f for f in resp.json() if f.get("id")]
