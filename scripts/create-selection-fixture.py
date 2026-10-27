"""Fixture sintética de integração; a transcrição correspondente é um stub declarado."""

import os
from pathlib import Path

from app.media import media_root, run_media

relative = Path(os.environ.get("SELECTION_FIXTURE_PATH", "fixtures/selection-smoke.mp4"))
root = media_root()
output = (root / relative).resolve()
if relative.is_absolute() or not output.is_relative_to(root) or output.exists():
    raise ValueError("Use um caminho novo dentro da raiz de mídia")
output.parent.mkdir(parents=True, exist_ok=True)
run_media(
    [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=24",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000",
        "-t",
        "12",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-c:a",
        "aac",
        str(output),
    ]
)
print(relative.as_posix())
