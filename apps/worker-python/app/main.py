from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="AutoClips AI — worker", version="0.1.0")


class Echo(BaseModel):
    message: str = Field(min_length=1, max_length=200)


@app.get("/health")
def health():
    return {"status": "ok", "service": "worker", "device": "cpu", "compute_type": "int8"}


@app.post("/echo")
def echo(request: Echo):
    return {"message": request.message, "service": "worker"}
