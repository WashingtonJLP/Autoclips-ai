"""Consulta real de metadados/formatos; não baixa mídia nem usa autenticação."""

import json
import sys
from datetime import UTC, datetime

from app.youtube import PublicYouTube, canonical_url, formats_for
from fastapi import HTTPException
from yt_dlp.utils import DownloadError

results = []
for value in sys.argv[1:] or [
    "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "https://youtu.be/BaW_jenozKc",
    "https://www.youtube.com/shorts/jNQXAC9IVRw",
]:
    result = {"url": canonical_url(value), "media_downloaded": False}
    try:
        with PublicYouTube(
            {
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "skip_download": True,
                "noplaylist": True,
                "cachedir": False,
                "geo_bypass": False,
                "proxy": "",
                "socket_timeout": 20,
                "retries": 0,
                "extractor_retries": 0,
                "js_runtimes": {},
                "remote_components": set(),
            }
        ) as extractor:
            info = extractor.extract_info(result["url"], download=False)
        result.update(
            {
                "title": info.get("title"),
                "duration": info.get("duration"),
                "license": info.get("license"),
                "availability": info.get("availability"),
                "formats": [
                    {
                        k: f.get(k)
                        for k in [
                            "format_id",
                            "protocol",
                            "ext",
                            "vcodec",
                            "acodec",
                            "height",
                            "has_drm",
                        ]
                    }
                    for f in info.get("formats", [])
                ],
            }
        )
        try:
            result["compatible_formats"] = [
                f.get("format_id") for f in formats_for(info)
            ]
        except HTTPException as exc:
            result["format_error"] = getattr(exc, "status_code", type(exc).__name__)
    except (HTTPException, DownloadError, OSError, ValueError) as exc:
        message = str(exc).lower()
        result["error"] = (
            "autenticação/controle de acesso"
            if any(v in message for v in ["sign in", "bot", "private", "403", "age"])
            else "indisponível"
            if any(v in message for v in ["unavailable", "removed"])
            else type(exc).__name__
        )
    results.append(result)
print(
    json.dumps(
        {"at": datetime.now(UTC).isoformat(), "results": results},
        ensure_ascii=False,
        indent=2,
    )
)
