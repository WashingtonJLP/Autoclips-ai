from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import media
from app.main import app

RIGHTS = {
    "license": "CC0",
    "evidence_url": "https://example.org/license",
    "attribution": "Teste sintético",
    "commercial_use_verified": True,
}


def test_paths_and_rights(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    client = TestClient(app)
    assert client.post("/transcribe", json={"path": "x.wav"}).status_code == 422
    assert (
        client.post("/transcribe", json={"path": "../x.wav", "rights": RIGHTS}).status_code == 400
    )
    assert client.post("/transcribe", json={"path": "x.wav", "rights": RIGHTS}).status_code == 404
    assert (
        client.post(
            "/transcribe",
            json={"path": "x.wav", "rights": {**RIGHTS, "commercial_use_verified": False}},
        ).status_code
        == 422
    )


def test_lock_released_after_failure():
    with pytest.raises(RuntimeError), media.sequential():
        with pytest.raises(HTTPException) as exc, media.sequential():
            pass
        assert exc.value.status_code == 429
        raise RuntimeError("simulação")
    with media.sequential():
        pass


def test_symlink_escape(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir()
    monkeypatch.setenv("MEDIA_ROOT", str(root))
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"test")
    try:
        (root / "link.wav").symlink_to(outside)
    except OSError:
        pytest.skip("Sistema exige privilégio para criar symlink")
    with pytest.raises(HTTPException):
        media.input_path("link.wav")


def test_missing_ffmpeg(monkeypatch):
    monkeypatch.setenv("PATH", "")
    with pytest.raises(HTTPException) as exc:
        media.duration(Path("example.wav"))
    assert exc.value.status_code == 503
