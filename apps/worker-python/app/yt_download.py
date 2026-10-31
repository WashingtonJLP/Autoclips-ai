"""Processo isolado: downloader de arquivo autorizado ou extrator YouTube dedicado."""

import json
import sys
import time

from fastapi import HTTPException
from yt_dlp import YoutubeDL
from yt_dlp.downloader.http import HttpFD
from yt_dlp.networking.common import Response

from app.downloads import DownloadRequest, public_response


class BoundedResponse(Response):
    def __init__(self, response, deadline):
        super().__init__(response, response.geturl(), dict(response.headers), response.status)
        self.deadline = deadline
        self.size = 0
        if int(self.headers.get("Content-Length", "0")) > 512 * 1024**2:
            self.close()
            raise HTTPException(413, "Download excede 512 MB")

    def read(self, amt=None):
        if time.monotonic() > self.deadline:
            raise HTTPException(504, "Tempo de download excedido")
        chunk = self.fp.read(min(amt or 1024**2, 1024**2))
        self.size += len(chunk)
        if self.size > 512 * 1024**2:
            raise HTTPException(413, "Download excede 512 MB")
        return chunk


class AuthorizedDownloader(YoutubeDL):
    def __init__(self, request):
        super().__init__(
            {
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "retries": 0,
                "continuedl": False,
                "nopart": True,
                "max_filesize": 512 * 1024**2,
                "buffersize": 64 * 1024,
                "geo_bypass": False,
                "proxy": "",
                "cachedir": False,
            },
            auto_init=False,
        )
        self.request = request
        self.deadline = time.monotonic() + 590
        self.opened = False

    def urlopen(self, request):
        # HttpFD recebe somente URL completa; não há playlists, manifestos ou fallback.
        if (
            request.url != str(self.request.url)
            or self.opened
            or request.method != "GET"
            or request.data is not None
        ):
            raise ValueError("Requisição não autorizada")
        self.opened = True
        return BoundedResponse(
            public_response(
                request.url,
                self.request.public_file_authorized,
                self.request.official_redirects,
            ),
            self.deadline,
        )


def run(request, output):
    with AuthorizedDownloader(request) as downloader:
        success = HttpFD(downloader, downloader.params).real_download(
            output,
            {
                "url": str(request.url),
                "http_headers": {},
                "id": request.key,
            },
        )
        if not success:
            raise ValueError("Arquivo indisponível")


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        request = DownloadRequest.model_validate(payload["request"])
        if request.engine == "youtube":
            from app.youtube import run as youtube_run

            youtube_run(request, payload["output"])
        else:
            run(request, payload["output"])
    except HTTPException as exc:
        # Apenas um código conhecido retorna ao processo pai; nunca URL assinada.
        print(json.dumps({"error": exc.status_code}))
        sys.exit(2)
