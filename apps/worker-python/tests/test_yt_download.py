import io
import subprocess
import time
from pathlib import Path

import pytest
from fastapi import HTTPException
from yt_dlp.networking import Request

from app import downloads, yt_download
from app.downloads import DownloadRequest, download, public_response
from tests.test_media import RIGHTS


class FileResponse(io.BytesIO):
    status = 200

    def __init__(self, content):
        super().__init__(content)
        self.headers = {"Content-Length": "4"}

    def geturl(self):
        return "https://example.org/authorized.mp4"


def request(**kwargs):
    return DownloadRequest(
        url="https://example.org/authorized.mp4",
        key="ab" * 32,
        rights=RIGHTS,
        engine="yt-dlp",
        public_file_authorized=True,
        **kwargs,
    )


def test_real_http_downloader_only_uses_one_authorized_file(tmp_path, monkeypatch):
    calls = []

    def opened(*args):
        calls.append(args)
        return FileResponse(b"test")

    monkeypatch.setattr(yt_download, "public_response", opened)
    output = tmp_path / "own.mp4"
    yt_download.run(request(), str(output))
    assert output.read_bytes() == b"test"
    assert len(calls) == 1
    with yt_download.AuthorizedDownloader(request()) as downloader:
        with pytest.raises(ValueError):
            downloader.urlopen(Request("https://other.org/file.mp4"))
        with pytest.raises(ValueError):
            downloader.urlopen(Request(str(request().url), method="POST", data=b"secret"))
        response = downloader.urlopen(Request(str(request().url)))
        response.close()
        with pytest.raises(ValueError):
            downloader.urlopen(Request(str(request().url)))


def test_content_length_stream_size_and_deadline_are_enforced():
    response = FileResponse(b"test")
    response.headers = {"Content-Length": str(513 * 1024**2)}
    with pytest.raises(HTTPException) as error:
        yt_download.BoundedResponse(response, time.monotonic() + 10)
    assert error.value.status_code == 413
    assert response.closed
    with yt_download.BoundedResponse(FileResponse(b"test"), time.monotonic() + 10) as bounded:
        bounded.size = 512 * 1024**2 - 1
        with pytest.raises(HTTPException):
            bounded.read(4)
    with (
        yt_download.BoundedResponse(FileResponse(b"test"), time.monotonic() - 1) as bounded,
        pytest.raises(HTTPException),
    ):
        bounded.read(4)


def test_parent_timeout_failure_and_hash_mismatch_leave_no_file(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(downloads, "validate_url", lambda *a: "93.184.216.34")
    monkeypatch.setattr(downloads, "duration", lambda p: 10)

    def timeout(*args, **kwargs):
        assert kwargs["timeout"] == 600
        raise subprocess.TimeoutExpired(args[0], 600)

    monkeypatch.setattr(downloads.subprocess, "run", timeout)
    with pytest.raises(HTTPException) as error:
        download(request())
    assert error.value.status_code == 504
    assert list((tmp_path / "downloads").iterdir()) == []

    def child(*args, **kwargs):
        import json

        payload = json.loads(kwargs["input"])
        Path(payload["output"]).write_bytes(b"test")
        return subprocess.CompletedProcess(args[0], 0)

    monkeypatch.setattr(downloads.subprocess, "run", child)
    with pytest.raises(HTTPException) as error:
        download(request(expected_sha1="00" * 20))
    assert error.value.status_code == 422
    assert list((tmp_path / "downloads").iterdir()) == []
    result = download(request())
    assert result["download_engine"] == "yt-dlp"
    monkeypatch.setattr(downloads.subprocess, "run", timeout)
    assert download(request())["path"] == result["path"]


def test_child_limit_error_is_safe_and_non_retryable(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(downloads, "validate_url", lambda *a: "93.184.216.34")
    monkeypatch.setattr(
        downloads.subprocess,
        "run",
        lambda *a, **kw: subprocess.CompletedProcess(
            a[0], 2, stdout='{"error":413}', stderr="signed-url-secret"
        ),
    )
    with pytest.raises(HTTPException) as error:
        download(request())
    assert error.value.status_code == 413
    assert "512 MB" in error.value.detail
    assert "secret" not in error.value.detail
    assert list((tmp_path / "downloads").iterdir()) == []


def test_official_redirect_revalidates_and_rejects_private_destination(monkeypatch):
    import urllib.error

    calls = []

    def validate(url, authorized):
        calls.append(url)
        if "localhost" in url:
            raise HTTPException(400, "Rede privada")
        return "93.184.216.34"

    class Redirect:
        def open(self, *args, **kwargs):
            raise urllib.error.HTTPError(
                "https://example.org/",
                302,
                "",
                {"Location": "https://localhost/private.mp4"},
                io.BytesIO(),
            )

    monkeypatch.setattr(downloads, "validate_url", validate)
    monkeypatch.setattr(downloads.urllib.request, "build_opener", lambda *a: Redirect())
    with pytest.raises(HTTPException):
        public_response("https://example.org/", True, True)
    assert calls == ["https://example.org/", "https://localhost/private.mp4"]
