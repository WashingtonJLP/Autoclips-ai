from fastapi import HTTPException

from app.contracts import ClipRequest
from app.media import duration, input_path, make_srt, output_path, relative, run_media


def create_clip(request: ClipRequest) -> dict:
    source = input_path(request.path)
    source_duration = duration(source)
    if request.end > source_duration + 0.05:
        raise HTTPException(422, "Corte excede a duração da mídia")
    output = output_path("mp4")
    subtitles = output.with_suffix(".srt")
    srt = make_srt(request.segments, request.start, request.end)
    if request.burn_subtitles and not srt:
        raise HTTPException(422, "Envie segmentos para inserir legendas")
    if srt:
        subtitles.write_text(srt, encoding="utf-8")
    filters = "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
    if request.burn_subtitles:
        # Apenas basename UUID gerado pelo servidor é interpolado no filtro.
        filters += (
            f",subtitles={subtitles.name}:force_style='FontSize=12,Outline=1,Shadow=0,"
            "MarginV=24,MarginL=18,MarginR=18'"
        )
    try:
        run_media(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-protocol_whitelist",
                "file,pipe",
                "-ss",
                str(request.start),
                "-i",
                str(source),
                "-t",
                str(request.end - request.start),
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-vf",
                filters,
                "-filter_threads",
                "1",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "23",
                "-threads",
                "2",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                str(output),
            ],
            cwd=output.parent,
        )
    except Exception:
        output.unlink(missing_ok=True)
        subtitles.unlink(missing_ok=True)
        raise
    return {
        "video_path": relative(output),
        "subtitle_path": relative(subtitles) if srt else None,
        "width": 720,
        "height": 1280,
        "start": request.start,
        "end": request.end,
        "publishing": "simulation",
    }
