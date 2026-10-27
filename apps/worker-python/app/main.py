from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.clips import create_clip
from app.contracts import ClipRequest, MediaRequest
from app.media import input_path, sequential, transcribe

app = FastAPI(title="AutoClips AI — worker", version="0.1.0")


class Echo(BaseModel):
    message: str = Field(min_length=1, max_length=200)


@app.get("/health")
def health():
    return {"status": "ok", "service": "worker", "device": "cpu", "compute_type": "int8"}


@app.post("/echo")
def echo(request: Echo):
    return {"message": request.message, "service": "worker"}


@app.post("/transcribe")
def transcribe_media(request: MediaRequest):
    path = input_path(request.path)
    with sequential():
        try:
            return transcribe(path)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, "Falha de transcrição; verifique modelo e recursos") from exc


@app.post("/clip")
def clip_media(request: ClipRequest):
    with sequential():
        return create_clip(request)
