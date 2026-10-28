"""Download direto e limitado de hosts aprovados, sem extratores de plataformas."""

import hashlib
import ipaddress
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.contracts import Rights
from app.media import duration, media_root, relative


class DownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: HttpUrl
    key: str = Field(pattern=r"^[a-f0-9]{64}$")
    rights: Rights
    expected_sha1: str | None = Field(default=None, pattern=r"^[a-f0-9]{40}$")


def validate_url(url: str):
    parsed = urlsplit(url)
    allowed = {"upload.wikimedia.org"} | set(
        filter(None, os.getenv("MEDIA_DOWNLOAD_HOSTS", "").split(","))
    )
    if (
        parsed.scheme != "https"
        or parsed.hostname not in allowed
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
    ):
        raise HTTPException(400, "Host de download não autorizado")
    for entry in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(entry[4][0]).is_global:
            raise HTTPException(400, "Endereço de rede não permitido")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPException(400, "Redirecionamento de download não permitido")


def download(request: DownloadRequest) -> dict:
    url = str(request.url)
    validate_url(url)
    extension = Path(urlsplit(url).path).suffix.lower()
    if extension not in {".mp4", ".webm", ".ogv", ".mov"}:
        raise HTTPException(400, "Formato de download não permitido")
    directory = media_root() / "downloads"
    if not directory.resolve().is_relative_to(media_root()):
        raise HTTPException(400, "Diretório inválido")
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{request.key}{extension}"
    if not target.resolve().is_relative_to(media_root()):
        raise HTTPException(400, "Arquivo fora do diretório de mídia")
    if target.is_file():
        duration(target)
        if request.expected_sha1:
            with target.open("rb") as existing:
                if hashlib.file_digest(existing, "sha1").hexdigest() != request.expected_sha1:
                    raise HTTPException(422, "Arquivo existente não corresponde à evidência")
        with target.open("rb") as existing:
            digest = hashlib.file_digest(existing, "sha256").hexdigest()
        return {"path": relative(target), "sha256": digest}
    temporary = directory / f".{request.key}.{uuid4().hex}.part"
    limit = 512 * 1024**2
    digest = hashlib.sha256()
    source_digest = hashlib.sha1()
    deadline = time.monotonic() + 600
    try:
        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(url, headers={"User-Agent": "AutoClipsAI/0.1"})
        with opener.open(req, timeout=30) as response, temporary.open("xb") as output:
            if int(response.headers.get("Content-Length", "0")) > limit:
                raise HTTPException(413, "Download excede 512 MB")
            size = 0
            while chunk := response.read(1024 * 1024):
                if time.monotonic() > deadline:
                    raise HTTPException(504, "Tempo de download excedido")
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, "Download excede 512 MB")
                digest.update(chunk)
                source_digest.update(chunk)
                output.write(chunk)
        if request.expected_sha1 and source_digest.hexdigest() != request.expected_sha1:
            raise HTTPException(422, "Download não corresponde à evidência da licença")
        duration(temporary)
        temporary.replace(target)
    except HTTPException:
        raise
    except (OSError, urllib.error.URLError, ValueError) as exc:
        raise HTTPException(503, "Download autorizado indisponível") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": relative(target), "sha256": digest.hexdigest()}
