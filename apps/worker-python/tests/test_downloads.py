import socket
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.downloads import DownloadRequest, NoRedirect, download, validate_url
from app.main import app
from tests.test_media import RIGHTS


def test_download_rejects_unapproved_and_private_hosts(monkeypatch):
    with pytest.raises(HTTPException):
        validate_url("https://localhost/test.mp4")
    with pytest.raises(HTTPException):
        validate_url("http://example.org/test.mp4")
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: [(0, 0, 0, "", ("127.0.0.1", 443))])
    with pytest.raises(HTTPException):
        validate_url("https://example.org/test.mp4")
    with pytest.raises(HTTPException):
        NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.invalid")


def test_download_streams_atomically_and_reuses_file(tmp_path, monkeypatch):
    from app import downloads

    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(downloads, "validate_url", lambda url, authorized=False: None)
    monkeypatch.setattr(downloads, "duration", lambda path: 10)

    class Response:
        def __init__(self):
            self.headers = {"Content-Length": "4"}
            self.sent = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            if self.sent:
                return b""
            self.sent = True
            return b"test"

    class Opener:
        def open(self, *args, **kwargs):
            return Response()

    monkeypatch.setattr(downloads.urllib.request, "build_opener", lambda *args: Opener())
    request = DownloadRequest(url="https://example.org/test.mp4", key="ab" * 32, rights=RIGHTS)
    result = download(request)
    assert (tmp_path / result["path"]).read_bytes() == b"test"
    assert len(result["sha256"]) == 64
    assert download(request) == result
    with pytest.raises(HTTPException) as mismatch:
        download(request.model_copy(update={"key": "cd" * 32, "expected_sha1": "00" * 20}))
    assert mismatch.value.status_code == 422
    assert not (tmp_path / "downloads" / f"{'cd' * 32}.mp4").exists()
    assert (tmp_path / result["path"]).read_bytes() == b"test"
    assert not list(tmp_path.rglob("*.part"))


def test_worker_auth_and_artifact_scope(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-secret")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.post("/echo", json={"message": "teste"}).status_code == 401
    headers = {"Authorization": "Bearer test-secret"}
    assert client.post("/echo", json={"message": "teste"}, headers=headers).status_code == 200
    directory = tmp_path / "outputs"
    directory.mkdir()
    filename = "ab" * 16 + ".srt"
    (directory / filename).write_text("legenda", encoding="utf-8")
    assert client.get(f"/artifacts/{filename}", headers=headers).text == "legenda"
    assert client.get("/artifacts/secrets.json", headers=headers).status_code == 404
    assert not Path(tmp_path / "secrets.json").exists()


def test_authorized_public_file_keeps_network_and_https_guards(monkeypatch):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **kw: [(0, 0, 0, "", ("93.184.216.34", 443))]
    )
    assert validate_url("https://example.org/own.mp4", True) == "93.184.216.34"
    for address in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"]:
        monkeypatch.setattr(
            socket, "getaddrinfo", lambda *a, ip=address, **kw: [(0, 0, 0, "", (ip, 443))]
        )
        with pytest.raises(HTTPException):
            validate_url("https://example.org/own.mp4", True)
    for url in [
        "http://example.org/a.mp4",
        "https://user:password@example.org/a.mp4",
        "https://example.org:8443/a.mp4",
    ]:
        with pytest.raises(HTTPException):
            validate_url(url, True)
