"""Obtenção de formatos públicos do YouTube; sem cookies ou contorno de acesso."""

import re
import subprocess
import time
import urllib.error
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from yt_dlp import YoutubeDL
from yt_dlp.downloader.http import HttpFD
from yt_dlp.networking.common import Response
from yt_dlp.networking.exceptions import HTTPError, TransportError
from yt_dlp.utils import DownloadError

from app.downloads import public_response, validate_url

LIMIT = 512 * 1024**2
HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}


def canonical_url(value):
    url = urlsplit(str(value))
    if (
        url.scheme != "https"
        or url.hostname not in HOSTS
        or url.username
        or url.password
        or url.port not in {None, 443}
    ):
        raise HTTPException(400, "URL YouTube inválida")
    path = url.path.rstrip("/")
    if url.hostname in {"youtu.be", "www.youtu.be"}:
        video = path.removeprefix("/")
    elif path == "/watch":
        video = parse_qs(url.query).get("v", [""])[0]
    else:
        match = re.fullmatch(r"/(?:shorts|embed|live|v)/([\w-]{11})", path)
        video = match[1] if match else ""
    if not re.fullmatch(r"[a-zA-Z0-9_-]{11}", video):
        raise HTTPException(400, "ID YouTube inválido")
    return f"https://www.youtube.com/watch?v={video}"


def google_media(value):
    url = urlsplit(value)
    if (
        url.scheme != "https"
        or not (url.hostname or "").endswith(".googlevideo.com")
        or url.username
        or url.password
        or url.port not in {None, 443}
    ):
        raise HTTPException(422, "Formato fora dos servidores de mídia do YouTube")
    return value


def formats_for(info):
    if (
        info.get("is_live")
        or info.get("live_status") in {"is_live", "is_upcoming"}
        or info.get("has_drm")
        or info.get("availability") not in {None, "public", "unlisted"}
    ):
        raise HTTPException(403, "Vídeo exige acesso restrito ou não está finalizado")
    if not 0 < (info.get("duration") or 0) <= 7200:
        raise HTTPException(422, "Duração ausente ou superior a duas horas")
    formats = [
        f
        for f in info.get("formats", [])
        if f.get("protocol") == "https"
        and not f.get("has_drm")
        and f.get("url")
        and (f.get("filesize") or 0) <= LIMIT
    ]
    videos = [
        f
        for f in formats
        if f.get("vcodec", "none") != "none" and 0 < (f.get("height") or 0) <= 720
    ]
    videos.sort(
        key=lambda f: (
            f.get("height") or 0,
            f.get("acodec", "none") != "none",
            f.get("ext") == "mp4",
        ),
        reverse=True,
    )
    for video in videos:
        if video.get("acodec", "none") != "none":
            return [video]
        audio = [
            f for f in formats if f.get("vcodec") == "none" and f.get("acodec", "none") != "none"
        ]
        audio.sort(key=lambda f: (f.get("ext") == "m4a", f.get("abr") or 0), reverse=True)
        if audio:
            return [video, audio[0]]
    raise HTTPException(422, "Nenhum formato HTTPS público com vídeo e áudio compatíveis")


class PublicYouTube(YoutubeDL):
    def urlopen(self, request):
        # Somente domínios fixos da plataforma; nenhuma URL de usuário arbitrária.
        host = urlsplit(request.url).hostname or ""
        if host not in HOSTS and not host.endswith(".googlevideo.com"):
            raise HTTPException(403, "Destino do extrator não autorizado")
        validate_url(request.url, True)
        return super().urlopen(request)


class TransferBudget:
    def __init__(self):
        self.received = 0
        self.deadline = time.monotonic() + 590

    def check(self, size=0):
        if time.monotonic() > self.deadline:
            raise HTTPException(504, "Tempo de download excedido")
        if self.received + size > LIMIT:
            raise HTTPException(413, "Download excede 512 MB")


class MediaResponse(Response):
    def __init__(self, response, budget):
        super().__init__(response, response.geturl(), dict(response.headers), response.status)
        self.budget = budget
        try:
            budget.check(int(self.headers.get("Content-Length", "0")))
        except (HTTPException, ValueError):
            self.close()
            raise

    def read(self, amt=None):
        self.budget.check()
        chunk = self.fp.read(min(amt or 1024**2, 1024**2))
        self.budget.check(len(chunk))
        self.budget.received += len(chunk)
        return chunk


class MediaDownloader(YoutubeDL):
    """HttpFD conserva Range/blocos; o transporte mantém DNS fixo e TLS validado."""

    def __init__(self, url, budget):
        super().__init__(
            {
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "retries": 0,
                "continuedl": False,
                "nopart": True,
                "max_filesize": LIMIT,
                "cachedir": False,
                "proxy": "",
                "geo_bypass": False,
            },
            auto_init=False,
        )
        self.allowed_url = google_media(url)
        self.budget = budget

    def urlopen(self, request):
        self.budget.check()
        if request.url != self.allowed_url or request.method != "GET" or request.data is not None:
            raise HTTPException(400, "Requisição de mídia não autorizada")
        # Somente cabeçalhos necessários ao downloader. Nunca cookies ou credenciais.
        allowed_headers = {
            "user-agent",
            "accept",
            "accept-language",
            "sec-fetch-mode",
            "range",
            "if-range",
        }
        headers = {k: v for k, v in request.headers.items() if k.lower() in allowed_headers}
        byte_range = next((v for k, v in headers.items() if k.lower() == "range"), None)
        if byte_range is not None and not re.fullmatch(r"bytes=\d+-\d*", byte_range):
            raise HTTPException(400, "Intervalo de mídia inválido")
        try:
            # Cada bloco recebe validação de DNS/IP e conexão fixada no endereço validado.
            # Redirects são recusados: o downloader só pode abrir a URL selecionada.
            response = public_response(self.allowed_url, True, headers=headers)
            return MediaResponse(response, self.budget)
        except urllib.error.HTTPError as exc:
            raise HTTPError(Response(exc, exc.geturl(), dict(exc.headers), exc.code)) from exc
        except urllib.error.URLError as exc:
            raise TransportError(cause=exc) from exc


def run(request, output):
    url = canonical_url(request.url)
    try:
        with PublicYouTube(
            {
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "noplaylist": True,
                "skip_download": True,
                "cachedir": False,
                "geo_bypass": False,
                "proxy": "",
                "socket_timeout": 20,
                "retries": 0,
                "extractor_retries": 0,
                # Não usa cookies, credenciais, tokens PO, impersonação ou solvers JS.
                "js_runtimes": {},
                "remote_components": set(),
            }
        ) as extractor:
            info = extractor.extract_info(url, download=False)
        selected = formats_for(info)
        budget = TransferBudget()
        if sum(media.get("filesize") or 0 for media in selected) > LIMIT:
            raise HTTPException(413, "Download excede 512 MB")
        inputs = []
        for index, media in enumerate(selected):
            path = Path(output).parent / f"stream-{index}.media"
            with MediaDownloader(media["url"], budget) as downloader:
                # Preserva http_headers e downloader_options.http_chunk_size do extrator.
                success, _ = HttpFD(downloader, downloader.params).download(str(path), media)
                if not success or not path.is_file() or not path.stat().st_size:
                    raise HTTPException(503, "Não foi possível baixar o formato do YouTube")
            inputs += ["-protocol_whitelist", "file,pipe", "-i", str(path)]
        mapping = ["-map", "0:v:0", "-map", "1:a:0" if len(selected) == 2 else "0:a:0"]
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-n",
                *inputs,
                *mapping,
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except DownloadError as exc:
        message = str(exc).lower()
        status = (
            429
            if "429" in message
            else 403
            if any(v in message for v in ["sign in", "private", "age", "403", "drm", "bot"])
            else 404
            if any(
                v in message for v in ["removed", "not available", "unavailable", "does not exist"]
            )
            else 503
        )
        raise HTTPException(status, "Acesso ao YouTube indisponível") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Tempo de processamento excedido") from exc
    except (subprocess.CalledProcessError, OSError) as exc:
        raise HTTPException(503, "Não foi possível preparar os formatos do YouTube") from exc
