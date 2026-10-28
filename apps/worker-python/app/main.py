import os
import re
import secrets

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.clips import create_clip
from app.contracts import ClipRequest, MediaRequest
from app.downloads import DownloadRequest, download
from app.media import input_path, media_root, sequential, transcribe

app = FastAPI(title="AutoClips AI — worker", version="0.1.0")


@app.middleware("http")
async def authenticate(request: Request, call_next):
    token = os.getenv("WORKER_API_TOKEN")
    if (
        request.url.path != "/health"
        and token
        and not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}")
    ):
        return JSONResponse({"detail": "Autenticação necessária"}, status_code=401)
    return await call_next(request)


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


@app.post("/download")
def download_media(request: DownloadRequest):
    with sequential():
        return download(request)


@app.get("/artifacts/{filename}")
def artifact(filename: str):
    if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|srt|json)", filename):
        raise HTTPException(404, "Artefato não encontrado")
    root = media_root()
    path = (root / "outputs" / filename).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(404, "Artefato não encontrado")
    types = {".mp4": "video/mp4", ".srt": "application/x-subrip", ".json": "application/json"}
    return FileResponse(
        path, media_type=types[path.suffix], filename=filename, content_disposition_type="inline"
    )
