import io
import socket
from pathlib import Path
from subprocess import CompletedProcess

import pytest
from fastapi import HTTPException
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
            return info()

    monkeypatch.setattr(youtube, "PublicYouTube", Extractor)
    monkeypatch.setattr(youtube, "public_response", lambda *a: io.BytesIO(b"video"))

    # BytesIO não possui headers; resposta mínima mantém o contrato HTTP.
    class Response(io.BytesIO):
        def __init__(self, data):
            super().__init__(data)
            self.headers = {"Content-Length": "5"}

    monkeypatch.setattr(youtube, "public_response", lambda *a: Response(b"video"))

    def ffmpeg(args, **kwargs):
        assert "copy" in args
        assert args[args.index("-i") + 1] == str(tmp_path / "stream-0.media")
        Path(args[-1]).write_bytes(b"mp4")
        return CompletedProcess(args, 0)

    monkeypatch.setattr(youtube.subprocess, "run", ffmpeg)
    request = DownloadRequest(
        url=f"https://youtu.be/{VIDEO}", key="ab" * 32, rights=RIGHTS, engine="youtube"
    )
    youtube.run(request, str(tmp_path / "out.mp4"))
    assert (tmp_path / "out.mp4").read_bytes() == b"mp4"


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
