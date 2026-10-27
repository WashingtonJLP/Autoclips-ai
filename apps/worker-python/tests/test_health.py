from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["compute_type"] == "int8"


def test_echo_validation():
    assert client.post("/echo", json={"message": "olá"}).json()["message"] == "olá"
    assert client.post("/echo", json={"message": ""}).status_code == 422
