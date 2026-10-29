import json
import shutil

import pytest
from fastapi import HTTPException

from app.clips import create_clip
from app.contracts import ClipRequest, Segment
from app.media import make_srt, run_media, srt_timestamp
from tests.test_media import RIGHTS


def test_subtitles_are_clamped_and_rebased():
    segments = [Segment(start=1, end=4, text="Olá\n\nmundo"), Segment(start=8, end=9, text="fora")]
    assert make_srt(segments, 2, 3) == "1\n00:00:00,000 --> 00:00:01,000\nOlá mundo\n"
    assert srt_timestamp(59.9996) == "00:01:00,000"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg ausente")
def test_real_vertical_clip(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    fixture = tmp_path / "test.mp4"
    run_media(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-c:a",
            "aac",
            str(fixture),
        ]
    )
    request = ClipRequest(
        path="test.mp4",
        rights=RIGHTS,
        start=0.5,
        end=1.5,
        segments=[Segment(start=0, end=2, text="Teste autorizado")],
        burn_subtitles=True,
    )
    output = create_clip(request)
    video = tmp_path / output["video_path"]
    probe = json.loads(
        run_media(
            ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]
        )
    )
    stream = next(item for item in probe["streams"] if item["codec_type"] == "video")
    assert (stream["width"], stream["height"]) == (720, 1280)
    assert abs(float(probe["format"]["duration"]) - 1) < 0.2
    assert (
        (tmp_path / output["subtitle_path"])
        .read_text(encoding="utf-8")
        .startswith("1\n00:00:00,000")
    )
    with pytest.raises(HTTPException) as exc:
        create_clip(ClipRequest(path="test.mp4", rights=RIGHTS, start=0, end=3))
    assert exc.value.status_code == 422


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg ausente")
def test_audio_podcast_renders_with_generated_background(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    run_media(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            "2",
            str(tmp_path / "podcast.wav"),
        ]
    )
    result = create_clip(
        ClipRequest(
            path="podcast.wav",
            rights=RIGHTS,
            start=0,
            end=1,
            segments=[Segment(start=0, end=1, text="Podcast autorizado")],
            burn_subtitles=True,
        )
    )
    info = json.loads(
        run_media(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-of",
                "json",
                str(tmp_path / result["video_path"]),
            ]
        )
    )
    assert any(s.get("width") == 720 and s.get("height") == 1280 for s in info["streams"])
    assert any(s.get("codec_name") == "aac" for s in info["streams"])
