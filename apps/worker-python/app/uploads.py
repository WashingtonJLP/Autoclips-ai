"""Entrada binária limitada, endereçada por SHA-256 e validada com FFprobe."""

import hashlib
import shutil
from uuid import uuid4

from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.media import duration, media_root, relative


async def upload(request: Request, extension: str):
    if extension not in {"mp4", "webm", "mov", "ogv", "mkv", "mp3", "wav", "m4a"}:
        raise HTTPException(400, "Formato de arquivo não permitido")
    root = media_root()
    directory = root / "uploads"
    if not directory.resolve().is_relative_to(root):
        raise HTTPException(400, "Diretório inválido")
    directory.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(directory).free < 1024**3:
        raise HTTPException(507, "Armazenamento insuficiente; libere espaço antes de importar")
    path = directory / f".{uuid4().hex}.part"
    size = 0
    digest = hashlib.sha256()
    try:
        with path.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > 512 * 1024**2:
                    raise HTTPException(413, "Arquivo excede 512 MB")
                digest.update(chunk)
                output.write(chunk)
        seconds = await run_in_threadpool(duration, path)
        target = directory / f"{digest.hexdigest()}.{extension}"
        path.replace(target)
        return {"path": relative(target), "sha256": digest.hexdigest(), "duration": seconds}
    finally:
        path.unlink(missing_ok=True)
