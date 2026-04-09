"""
Descarga de logos de tenant desde URLs públicas.

Muchos hosts/CDN bloquean el User-Agent por defecto de urllib (403), lo que dejaba
sin logo los PDFs cuando logo_url apuntaba a una imagen externa en lugar de /uploads/...
"""
from __future__ import annotations

from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def sniff_image_media_type(content: bytes, url: str = "") -> str:
    if len(content) >= 8 and content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(content) >= 2 and content[:2] == b"\xff\xd8":
        return "image/jpeg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if len(content) >= 6 and content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    path = (urlparse(url).path or "").lower()
    ext = Path(path).suffix
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "application/octet-stream")


def fetch_remote_tenant_logo(url: str, timeout: int = 12) -> tuple[bytes, str] | None:
    """
    GET de la imagen con User-Agent de navegador y Content-Type coherente (magic bytes / extensión)
    cuando el servidor devuelve application/octet-stream.
    """
    raw = (url or "").strip()
    if raw.startswith("//"):
        raw = "https:" + raw
    if not (raw.startswith("http://") or raw.startswith("https://")):
        return None

    req = Request(raw, headers={"User-Agent": _DEFAULT_UA})
    try:
        with urlopen(req, timeout=timeout) as resp:
            content = resp.read()
            declared = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    except (HTTPError, URLError, OSError, TimeoutError, ValueError):
        return None

    if not content:
        return None

    if declared.startswith("image/"):
        return content, declared

    media = sniff_image_media_type(content, raw)
    if media.startswith("image/"):
        return content, media
    return None
