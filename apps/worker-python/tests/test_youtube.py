import io
import socket
import time
from pathlib import Path
from subprocess import CompletedProcess

import pytest
from fastapi import HTTPException
from yt_dlp.networking import Request
from yt_dlp.utils import DownloadError

from app import youtube
from app.downloads import DownloadRequest, download
from tests.test_media import RIGHTS

VIDEO = "ACtest00001"


@pytest.mark.parametrize(
    "url",
    [
        f"https://youtube.com/watch?v={VIDEO}&t=2",
        f"https://youtu.be/{VIDEO}?si=a",
        f"https://youtube.com/shorts/{VIDEO}",
        f"https://youtube.com/embed/{VIDEO}",
        f"https://www.youtube-nocookie.com/embed/{VIDEO}",
        f"https://m.youtube.com/watch?v={VIDEO}",
        f"https://youtube.com/live/{VIDEO}",
        f"https://youtube.com/v/{VIDEO}",
    ],
)
def test_url_identity(url):
    assert youtube.canonical_url(url) == f"https://www.youtube.com/watch?v={VIDEO}"


@pytest.mark.parametrize(
    "url",
    [
        "https://youtube.com/playlist?list=x",
        "https://youtube.com.evil.test/watch?v=ACtest00001",
        "https://user:pass@youtube.com/watch?v=ACtest00001",
        "http://youtu.be/ACtest00001",
        "https://youtu.be/short",
        "https://youtu.be:444/ACtest00001",
    ],
)
def test_invalid_urls(url):
    with pytest.raises(HTTPException):
        youtube.canonical_url(url)


def info(**extra):
    return {
        "duration": 30,
        "availability": "public",
        "license": "Standard YouTube License",
        "formats": [
            {
                "format_id": "18",
                "protocol": "https",
                "height": 360,
                "vcodec": "avc1",
                "acodec": "mp4a",
                "ext": "mp4",
                "url": "https://rr1.googlevideo.com/videoplayback?signature=example",
            }
        ],
        **extra,
    }


def test_standard_license_does_not_block_format_inspection():
    assert youtube.formats_for(info())[0]["format_id"] == "18"
    adaptive = info()["formats"][0] | {"height": 720, "acodec": "none"}
    audio = adaptive | {"height": None, "vcodec": "none", "acodec": "aac", "ext": "m4a"}
    assert youtube.formats_for(info(formats=[adaptive, audio])) == [adaptive, audio]


@pytest.mark.parametrize(
    "extra",
    [
        {"has_drm": True},
        {"availability": "private"},
        {"is_live": True},
        {"duration": 7201},
        {"formats": []},
        {"formats": [info()["formats"][0] | {"protocol": "m3u8_native"}]},
    ],
)
def test_real_restrictions(extra):
    with pytest.raises(HTTPException):
        youtube.formats_for(info(**extra))


def test_media_hosts_cannot_escape():
    for url in [
        "https://googlevideo.com.evil.test/x",
        "http://rr1.googlevideo.com/x",
        "https://127.0.0.1/x",
        "https://user:pass@rr1.googlevideo.com/x",
    ]:
        with pytest.raises(HTTPException):
            youtube.google_media(url)


def test_download_selected_formats_and_remux_locally(tmp_path, monkeypatch):
    calls = []

    class Extractor:
        def __init__(self, options):
            assert options["geo_bypass"] is False
            assert not options.get("cookiefile")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def extract_info(self, url, download):
            assert download is False
            return info(
                formats=[
                    info()["formats"][0]
                    | {
                        "filesize": 8,
                        "http_headers": {"User-Agent": "extractor-test"},
                        "downloader_options": {"http_chunk_size": 3},
                    }
                ]
            )

    monkeypatch.setattr(youtube, "PublicYouTube", Extractor)

    class Response(io.BytesIO):
        def __init__(self, data, start, end):
            super().__init__(data)
            self.status = 206
            self.headers = {
                "Content-Length": str(len(data)),
                "Content-Range": f"bytes {start}-{end}/8",
            }

        def geturl(self):
            return info()["formats"][0]["url"]

    def opened(url, authorized, *, headers):
        assert url == info()["formats"][0]["url"]
        assert authorized is True
        assert headers["User-Agent"] == "extractor-test"
        start, end = map(int, headers["Range"].removeprefix("bytes=").split("-"))
        assert end - start + 1 <= 3
        calls.append((start, end))
        return Response(b"video123"[start : end + 1], start, end)

    monkeypatch.setattr(youtube, "public_response", opened)

    def ffmpeg(args, **kwargs):
        assert "copy" in args
        assert args[args.index("-i") + 1] == str(tmp_path / "stream-0.media")
        assert (tmp_path / "stream-0.media").read_bytes() == b"video123"
        Path(args[-1]).write_bytes(b"mp4")
        return CompletedProcess(args, 0)

    monkeypatch.setattr(youtube.subprocess, "run", ffmpeg)
    request = DownloadRequest(
        url=f"https://youtu.be/{VIDEO}", key="ab" * 32, rights=RIGHTS, engine="youtube"
    )
    youtube.run(request, str(tmp_path / "out.mp4"))
    assert (tmp_path / "out.mp4").read_bytes() == b"mp4"
    assert len(calls) >= 3, "O downloader real deve respeitar os blocos do extrator"


def test_native_downloader_keeps_network_scope_and_drops_credentials(monkeypatch):
    media_url = info()["formats"][0]["url"]
    budget = youtube.TransferBudget()
    with youtube.MediaDownloader(media_url, budget) as downloader:
        for request in [
            Request("https://example.org/file.mp4"),
            Request(media_url, method="POST", data=b"body"),
            Request(media_url, headers={"range": "bytes=invalid"}),
        ]:
            with pytest.raises(HTTPException):
                downloader.urlopen(request)
        monkeypatch.setattr(
            socket, "getaddrinfo", lambda *a, **kw: [(0, 0, 0, "", ("127.0.0.1", 443))]
        )
        with pytest.raises(HTTPException) as private:
            downloader.urlopen(Request(media_url))
        assert private.value.status_code == 400

        def opened(url, authorized, *, headers):
            assert not any(k.lower() in {"authorization", "cookie"} for k in headers)
            raise HTTPException(400, "Destino bloqueado pelo transporte")

        monkeypatch.setattr(youtube, "public_response", opened)
        with pytest.raises(HTTPException):
            downloader.urlopen(
                Request(media_url, headers={"Cookie": "secret", "Authorization": "Bearer secret"})
            )


def test_budget_is_shared_across_formats_and_chunks(monkeypatch):
    class Response(io.BytesIO):
        status = 200
        headers = None

        def __init__(self):
            super().__init__(b"abcd")
            self.headers = {"Content-Length": "4"}

        def geturl(self):
            return info()["formats"][0]["url"]

    monkeypatch.setattr(youtube, "LIMIT", 7)
    budget = youtube.TransferBudget()
    with youtube.MediaResponse(Response(), budget) as response:
        assert response.read(4) == b"abcd"
    with pytest.raises(HTTPException) as error:
        youtube.MediaResponse(Response(), budget)
    assert error.value.status_code == 413
    budget.deadline = time.monotonic() - 1
    with pytest.raises(HTTPException) as error:
        budget.check()
    assert error.value.status_code == 504


def test_imported_youtube_reused_without_network(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    from app import downloads

    monkeypatch.setattr(downloads, "duration", lambda _: 30)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a: pytest.fail("Não consultar DNS"))
    (tmp_path / "downloads").mkdir()
    (tmp_path / "downloads" / ("ab" * 32 + ".mp4")).write_bytes(b"existing")
    request = DownloadRequest(
        url=f"https://youtu.be/{VIDEO}", key="ab" * 32, rights=RIGHTS, engine="youtube"
    )
    assert download(request)["path"] == "downloads/" + "ab" * 32 + ".mp4"


@pytest.mark.parametrize(
    "message,status",
    [
        ("Video unavailable. Sign in to confirm your age", 403),
        ("HTTP Error 429: Too Many Requests", 429),
        ("Video unavailable", 404),
        ("Network error", 503),
    ],
)
def test_extractor_errors_are_distinct_from_authorization(message, status, tmp_path, monkeypatch):
    class Extractor:
        def __init__(self, options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def extract_info(self, *args, **kwargs):
            raise DownloadError(message)

    monkeypatch.setattr(youtube, "PublicYouTube", Extractor)
    request = DownloadRequest(
        url=f"https://youtu.be/{VIDEO}", key="ab" * 32, rights=RIGHTS, engine="youtube"
    )
    with pytest.raises(HTTPException) as error:
        youtube.run(request, str(tmp_path / "out.mp4"))
    assert error.value.status_code == status
    assert not (tmp_path / "out.mp4").exists()
