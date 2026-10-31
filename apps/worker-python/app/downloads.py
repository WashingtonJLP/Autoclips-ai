"""Download direto e limitado de hosts aprovados, sem extratores de plataformas."""

import hashlib
import http.client
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Literal
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
    public_file_authorized: bool = False
    engine: Literal["native", "yt-dlp"] = "native"
    file_extension: Literal["mp4", "webm", "mov", "ogv"] | None = None
    official_redirects: bool = False


def validate_url(url: str, public_file_authorized: bool = False):
    parsed = urlsplit(url)
    allowed = {"upload.wikimedia.org"} | set(
        filter(None, os.getenv("MEDIA_DOWNLOAD_HOSTS", "").split(","))
    )
    if (
        parsed.scheme != "https"
        or (parsed.hostname not in allowed and not public_file_authorized)
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
    ):
        raise HTTPException(400, "Host de download não autorizado")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(
            400,
            "Não foi possível localizar o arquivo neste domínio. Confira o link ou envie o original.",
        ) from exc
    if not addresses:
        raise HTTPException(400, "Host sem endereço público")
    for entry in addresses:
        if not ipaddress.ip_address(entry[4][0]).is_global:
            raise HTTPException(400, "Endereço de rede não permitido")
    return addresses[0][4][0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, *, address, **kwargs):
        super().__init__(host, **kwargs)
        self.address = address

    def connect(self):
        # Conecta ao IP validado, preservando SNI e validação do certificado.
        # Não há segunda resolução DNS, proxy ou túnel que permita DNS rebinding.
        self.sock = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


class PinnedHandler(urllib.request.HTTPSHandler):
    def __init__(self, address):
        super().__init__()
        self.address = address

    def https_open(self, req):
        return self.do_open(
            lambda host, **kwargs: PinnedHTTPS(host, address=self.address, **kwargs), req
        )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPException(400, "Redirecionamento de download não permitido")


def download(request: DownloadRequest) -> dict:
    url = str(request.url)
    address = validate_url(url, request.public_file_authorized)
    extension = (
        f".{request.file_extension}"
        if request.file_extension
        else Path(urlsplit(url).path).suffix.lower()
    )
    if extension not in {".mp4", ".webm", ".ogv", ".mov", ".mp3", ".wav", ".m4a"}:
        raise HTTPException(400, "Formato de download não permitido")
    directory = media_root() / "downloads"
    if not directory.resolve().is_relative_to(media_root()):
        raise HTTPException(400, "Diretório inválido")
    directory.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(directory).free < 1024**3:
        raise HTTPException(507, "Armazenamento insuficiente; libere espaço antes de importar")
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
    if request.engine == "yt-dlp":
        return download_with_ytdlp(request, target)
    temporary = directory / f".{request.key}.{uuid4().hex}.part"
    limit = 512 * 1024**2
    digest = hashlib.sha256()
    source_digest = hashlib.sha1()
    deadline = time.monotonic() + 600
    try:
        with (
            public_response(
                url, request.public_file_authorized, request.official_redirects, address=address
            ) as response,
            temporary.open("xb") as output,
        ):
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


def public_response(url, authorized, redirects=False, *, address=None):
    """Redirects oficiais limitados; cada destino recebe DNS/IP/TLS novos e validados."""
    from urllib.parse import urljoin

    class StopRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    for hop in range(4):
        ip = address if hop == 0 and address else validate_url(url, authorized)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            StopRedirect if redirects else NoRedirect,
            PinnedHandler(ip),
        )
        try:
            return opener.open(
                urllib.request.Request(
                    url, headers={"User-Agent": "AutoClipsAI/0.1", "Accept-Encoding": "identity"}
                ),
                timeout=30,
            )
        except urllib.error.HTTPError as exc:
            location = exc.headers.get("Location")
            exc.close()
            if not redirects or exc.code not in {301, 302, 303, 307, 308} or not location:
                raise
            if hop == 3:
                raise HTTPException(400, "Excesso de redirecionamentos do arquivo oficial") from exc
            url = urljoin(url, location)
    raise HTTPException(400, "Arquivo oficial indisponível")


def download_with_ytdlp(request, target):
    # Processo isolado para impor prazo total mesmo durante DNS/socket/biblioteca.
    # Não executa extratores, FFmpeg externo, cookies ou configurações de usuário.
    with tempfile.TemporaryDirectory(prefix=".authorized-", dir=target.parent) as directory:
        temporary = Path(directory) / target.name
        try:
            result = subprocess.run(
                [sys.executable, "-m", "app.yt_download"],
                input=json.dumps(
                    {"request": request.model_dump(mode="json"), "output": str(temporary)}
                ),
                capture_output=True,
                text=True,
                timeout=600,
                check=False,
            )
            if result.returncode:
                if result.returncode == 2:
                    try:
                        status = json.loads(result.stdout).get("error")
                    except (ValueError, AttributeError):
                        status = None
                    messages = {
                        400: "Este endereço não permite importação segura. Use outro original autorizado.",
                        413: "Download excede 512 MB. Envie uma versão menor do original autorizado.",
                        504: "Tempo de download excedido. Tente novamente ou envie o original autorizado.",
                    }
                    if isinstance(status, int) and status in messages:
                        raise HTTPException(status, messages[status])
                # Não propaga URLs assinadas, tokens ou diagnóstico interno da biblioteca.
                raise HTTPException(
                    503,
                    "Não foi possível obter o arquivo autorizado. "
                    "Confira se o acesso ainda é válido ou envie o original.",
                )
            if not temporary.is_file() or temporary.stat().st_size > 512 * 1024**2:
                raise HTTPException(413, "Download ausente ou excede 512 MB")
            duration(temporary)
            with temporary.open("rb") as content:
                sha256 = hashlib.file_digest(content, "sha256").hexdigest()
            if request.expected_sha1:
                with temporary.open("rb") as content:
                    if hashlib.file_digest(content, "sha1").hexdigest() != request.expected_sha1:
                        raise HTTPException(422, "Download não corresponde à evidência da licença")
            temporary.replace(target)
            return {"path": relative(target), "sha256": sha256, "download_engine": "yt-dlp"}
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "Tempo de download excedido") from exc
