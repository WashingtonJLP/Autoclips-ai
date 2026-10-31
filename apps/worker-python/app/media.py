import json
import os
import shutil
import subprocess
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from uuid import uuid4

from fastapi import HTTPException

from app.contracts import Segment

processing_lock = Lock()
_model = None


def media_root() -> Path:
    return Path(os.getenv("MEDIA_ROOT", "../../media")).resolve()


def input_path(relative: str) -> Path:
    root = media_root()
    requested = Path(relative)
    path = (root / requested).resolve()
    if requested.is_absolute() or ":" in relative or not path.is_relative_to(root):
        raise HTTPException(400, "Arquivo fora do diretório de mídia")
    if path.suffix.lower() not in {".mp4", ".mkv", ".mov", ".webm", ".ogv", ".wav", ".mp3", ".m4a"}:
        raise HTTPException(400, "Formato de mídia não permitido")
    if not path.is_file():
        raise HTTPException(404, "Arquivo de mídia não encontrado")
    if path.stat().st_size > 2 * 1024**3:
        raise HTTPException(413, "Arquivo excede 2 GB")
    return path


@contextmanager
def sequential():
    if not processing_lock.acquire(blocking=False):
        raise HTTPException(
            429,
            {
                "code": "WORKER_BUSY",
                "message": "Outra etapa está em execução. A produção aguarda o worker.",
            },
            headers={"Retry-After": "5"},
        )
    try:
        yield
    finally:
        processing_lock.release()


def run_media(args: list[str], *, cwd: Path | None = None, timeout: int = 600) -> str:
    try:
        result = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except FileNotFoundError as exc:
        raise HTTPException(503, "FFmpeg/FFprobe indisponível") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Tempo de processamento excedido") from exc
    if result.returncode:
        # Não retornar caminhos internos nem stderr bruto ao cliente.
        raise HTTPException(422, "Mídia inválida ou operação não suportada")
    return result.stdout


def duration(path: Path) -> float:
    raw = run_media(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        timeout=30,
    )
    try:
        value = float(json.loads(raw)["format"]["duration"])
        if not 0 < value <= 7200:
            raise ValueError
        return value
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(422, "Mídia deve durar até duas horas") from exc


def output_path(extension: str) -> Path:
    root = media_root()
    directory = root / "outputs"
    if not directory.resolve().is_relative_to(root):
        raise HTTPException(400, "Diretório de saída inválido")
    directory.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(directory).free < 1024**3:
        raise HTTPException(507, "Armazenamento insuficiente; libere espaço para continuar")
    return directory / f"{uuid4().hex}.{extension}"


def relative(path: Path) -> str:
    return path.relative_to(media_root()).as_posix()


def transcribe(path: Path, language: str | None = None) -> dict:
    global _model
    duration(path)
    if _model is None:
        from faster_whisper import WhisperModel

        model_name = os.getenv("WHISPER_MODEL", "tiny")
        if model_name not in {"tiny", "base", "tiny.en", "base.en"}:
            raise HTTPException(503, "Modelo deve ser tiny ou base")
        _model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            cpu_threads=int(os.getenv("WHISPER_CPU_THREADS", "2")),
            num_workers=1,
            download_root=os.getenv("HF_HOME", "../../models"),
        )
    segments, info = _model.transcribe(
        str(path), beam_size=1, vad_filter=True, word_timestamps=True, language=language
    )
    result = {
        "transcription_engine": "faster-whisper",
        "device": "cpu",
        "compute_type": "int8",
        "word_timestamps": True,
        "language": info.language,
        "duration": info.duration,
        "segments": [
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
                "words": [
                    {"start": word.start, "end": word.end, "word": word.word}
                    for word in (segment.words or [])
                ],
            }
            for segment in segments
        ],
    }
    output = output_path("json")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return {**result, "transcript_path": relative(output)}


def srt_timestamp(seconds: float) -> str:
    ms = round(seconds * 1000)
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds_int, ms = divmod(ms, 1000)
    return f"{hours:02}:{minutes:02}:{seconds_int:02},{ms:03}"


def make_srt(segments: list[Segment], start: float, end: float) -> str:
    lines = []
    for segment in sorted(segments, key=lambda item: item.start):
        left, right = max(start, segment.start), min(end, segment.end)
        if right <= left:
            continue
        text = " ".join(segment.text.split()).replace("<", "").replace(">", "")
        lines.append(
            f"{len(lines) + 1}\n{srt_timestamp(left - start)} --> {srt_timestamp(right - start)}\n{text}\n"
        )
    return "\n".join(lines)
