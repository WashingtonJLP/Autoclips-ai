"""RSS de podcasts/repositórios aprovados pelo operador; descoberta não concede direitos."""

import json
import os
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.downloads import NoRedirect, PinnedHandler, validate_url


class FeedRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    url: str | None = None


def discover_feeds(request: FeedRequest):
    urls = json.loads(os.getenv("SOURCE_FEED_URLS", "[]"))
    if not isinstance(urls, list) or len(urls) > 10:
        raise HTTPException(400, "Configure até dez feeds RSS autorizados")
    if request.url:
        if request.url not in urls:
            raise HTTPException(400, "Feed não aprovado pelo operador em SOURCE_FEED_URLS")
        urls = [request.url]
    if not urls:
        raise HTTPException(
            400, "Configure SOURCE_FEED_URLS e MEDIA_DOWNLOAD_HOSTS para buscar podcasts/RSS"
        )
    items = []
    for url in urls:
        address = validate_url(url)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect, PinnedHandler(address)
        )
        with opener.open(url, timeout=20) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
            raise HTTPException(400, "Feed excede limite ou contém entidades não permitidas")
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as exc:
            raise HTTPException(422, "Feed RSS inválido") from exc
        channel = root.find("channel")
        if channel is None:
            raise HTTPException(422, "Use um feed RSS 2.0 com enclosures de mídia")
        language = channel.findtext("language")
        for entry in channel.findall("item")[:100]:
            title = entry.findtext("title", "Episódio")[:200]
            if not any(word.lower() in title.lower() for word in request.query.split()):
                continue
            enclosure = entry.find("enclosure")
            if enclosure is None:
                continue
            media_url = enclosure.get("url", "")
            if urlsplit(media_url).scheme != "https":
                continue
            try:
                validate_url(media_url)
                accessible = True
            except (HTTPException, OSError, ValueError):
                accessible = False
            date = None
            try:
                date = parsedate_to_datetime(entry.findtext("pubDate", "")).isoformat()
            except (ValueError, TypeError):
                pass
            seconds = None
            duration = entry.findtext("{http://www.itunes.com/dtds/podcast-1.0.dtd}duration")
            if duration:
                try:
                    parts = [float(p) for p in duration.split(":")]
                    seconds = sum(v * 60**i for i, v in enumerate(reversed(parts)))
                except ValueError:
                    pass
            items.append(
                {
                    "externalId": entry.findtext("guid") or media_url,
                    "url": entry.findtext("link") or media_url,
                    "title": title,
                    "author": entry.findtext("author") or channel.findtext("title"),
                    "mediaUrl": media_url,
                    "accessible": accessible,
                    "language": language,
                    "publishedAt": date,
                    "duration": seconds,
                    "metadata": {"feedUrl": url, "license": "Não informada"},
                }
            )
    return {"items": items[:50]}
