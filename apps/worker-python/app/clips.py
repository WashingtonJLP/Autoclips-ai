import json

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
        streams = json.loads(
            run_media(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-show_entries",
                    "stream=codec_type",
                    "-of",
                    "json",
                    str(source),
                ],
                timeout=30,
            )
        )["streams"]
        has_video = any(s.get("codec_type") == "video" for s in streams)
        inputs = (
            ["-ss", str(request.start), "-i", str(source)]
            if has_video
            else [
                "-f",
                "lavfi",
                "-i",
                "color=c=0x111827:s=720x1280:r=30",
                "-ss",
                str(request.start),
                "-i",
                str(source),
            ]
        )
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
                *inputs,
                "-t",
                str(request.end - request.start),
                "-map",
                "0:v:0",
                "-map",
                "0:a?" if has_video else "1:a:0",
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
        info = json.loads(
            run_media(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_streams",
                    "-show_format",
                    "-of",
                    "json",
                    str(output),
                ],
                timeout=30,
            )
        )
        expected = request.end - request.start
        valid_video = any(
            s.get("codec_name") == "h264" and s.get("width") == 720 and s.get("height") == 1280
            for s in info["streams"]
        )
        source_audio = any(s.get("codec_type") == "audio" for s in streams)
        valid_audio = not source_audio or any(s.get("codec_name") == "aac" for s in info["streams"])
        if (
            not valid_video
            or not valid_audio
            or abs(float(info["format"]["duration"]) - expected) > 0.3
        ):
            raise HTTPException(
                422, "O corte gerado não passou na validação de formato, áudio ou duração"
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
        "quality": {
            "validated": True,
            "duration": float(info["format"]["duration"]),
            "video_codec": "h264",
            "audio_validated": valid_audio,
        },
    }
