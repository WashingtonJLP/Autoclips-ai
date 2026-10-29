from app import feeds


def test_rss_discovery_keeps_rights_unknown_and_parses_podcast(monkeypatch):
    monkeypatch.setenv("SOURCE_FEED_URLS", '["https://example.org/feed.xml"]')
    monkeypatch.setattr(feeds, "validate_url", lambda url: "93.184.216.34")
    xml = b"""<rss><channel><title>Podcast</title><language>pt-BR</language><item>
    <title>Tecnologia aberta</title><guid>episodio-1</guid><link>https://example.org/1</link>
    <enclosure url="https://example.org/1.mp3" type="audio/mpeg"/>
    <pubDate>Thu, 29 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>"""

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            return xml

    class Opener:
        def open(self, *args, **kwargs):
            return Response()

    monkeypatch.setattr(feeds.urllib.request, "build_opener", lambda *args: Opener())
    item = feeds.discover_feeds(feeds.FeedRequest(query="tecnologia"))["items"][0]
    assert item["externalId"] == "episodio-1"
    assert item["language"] == "pt-BR"
    assert item["metadata"]["license"] == "Não informada"
    assert item["accessible"] is True
