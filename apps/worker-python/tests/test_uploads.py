import hashlib

from fastapi.testclient import TestClient

from app.main import app


def test_upload_validates_media_deduplicates_and_cleans_up(tmp_path, monkeypatch):
    from app import uploads

    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.delenv("WORKER_API_TOKEN", raising=False)
    monkeypatch.setattr(uploads, "duration", lambda path: 10)
    client = TestClient(app)
    response = client.post("/upload?extension=mp4", content=b"authorized fixture")
    assert response.status_code == 200
    data = response.json()
    assert data["sha256"] == hashlib.sha256(b"authorized fixture").hexdigest()
    assert (tmp_path / data["path"]).read_bytes() == b"authorized fixture"
    assert client.post("/upload?extension=mp4", content=b"authorized fixture").json() == data
    assert client.post("/upload?extension=exe", content=b"bad").status_code == 400
    assert not list(tmp_path.rglob("*.part"))
