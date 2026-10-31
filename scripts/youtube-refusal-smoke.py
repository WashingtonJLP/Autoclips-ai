"""Testa somente recusa de URL indisponível; não produz nem simula mídia."""

import hashlib
import json

from app.downloads import DownloadRequest, download
from app.media import media_root
from fastapi import HTTPException

key = hashlib.sha256(b"autoclips-unavailable-youtube-refusal").hexdigest()
target = media_root() / "downloads" / f"{key}.mp4"
assert not target.exists(), "Teste de recusa não pode reutilizar mídia existente"
try:
    download(
        DownloadRequest(
            url="https://www.youtube.com/watch?v=BaW_jenozKc",
            key=key,
            engine="youtube",
            rights={
                "license": "PERMISSION",
                "commercial_use_verified": True,
                "evidence_url": "https://github.com/yt-dlp/yt-dlp",
                "attribution": "Teste de recusa de URL indisponível, sem processamento de mídia.",
            },
        )
    )
    raise AssertionError(
        "URL antes indisponível mudou de comportamento; revisar evidência"
    )
except HTTPException as exc:
    assert exc.status_code in {403, 404, 422, 429, 503, 504}
    assert not target.exists()
    print(
        json.dumps(
            {
                "status": exc.status_code,
                "message": exc.detail,
                "media_downloaded": False,
                "url": "https://youtu.be/BaW_jenozKc",
            },
            ensure_ascii=False,
        )
    )
