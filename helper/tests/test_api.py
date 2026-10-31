"""Test API helper không cần mạng: thư viện, phát media, chặn origin lạ."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas.track_schema import MediaMode, Track

EXT_ORIGIN = "chrome-extension://abcdefghijklmnop"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """App dùng thư mục dữ liệu tạm."""
    app = create_app(Settings(data_dir=tmp_path))
    with TestClient(app) as test_client:
        yield test_client


def _add_track(client: TestClient, body: bytes = b"0123456789") -> Track:
    """Ghi thẳng một bài giả vào thư viện."""
    repo = client.app.state.repo
    track = Track(
        id="abc-audio", source_id="abc", source_url="https://youtu.be/abc", title="Bài thử",
        mode=MediaMode.AUDIO, filename="abc-audio.m4a", added_at=datetime.now(UTC),
    )
    (repo._media_dir / track.filename).write_bytes(body)
    repo.add(track)
    return track


def test_health(client: TestClient) -> None:
    """Health trả ok."""
    res = client.get("/api/health", headers={"Origin": EXT_ORIGIN})
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_foreign_origin_blocked(client: TestClient) -> None:
    """Trang web lạ không gọi được helper."""
    res = client.post("/api/downloads", json={"url": "https://youtu.be/x"}, headers={"Origin": "https://evil.example"})
    assert res.status_code == 403


def test_rejects_non_http_url(client: TestClient) -> None:
    """Link không phải http(s) bị từ chối trước khi tới yt-dlp."""
    res = client.post("/api/downloads", json={"url": "file:///etc/passwd"}, headers={"Origin": EXT_ORIGIN})
    assert res.status_code == 422


def test_list_stream_delete(client: TestClient) -> None:
    """Liệt kê, phát có Range, xóa cả file."""
    track = _add_track(client)
    listed = client.get("/api/tracks").json()
    assert [t["id"] for t in listed["tracks"]] == [track.id]

    partial = client.get(f"/media/{track.id}", headers={"Range": "bytes=2-5"})
    assert partial.status_code == 206
    assert partial.content == b"2345"
    assert partial.headers["content-type"] == "audio/mp4"

    cors = client.get(f"/media/{track.id}", headers={"Origin": EXT_ORIGIN, "Range": "bytes=0-1"})
    assert cors.headers["access-control-allow-origin"] == EXT_ORIGIN

    assert client.delete(f"/api/tracks/{track.id}", headers={"Origin": EXT_ORIGIN}).status_code == 204
    assert client.get("/api/tracks").json()["tracks"] == []
    assert client.get(f"/media/{track.id}").status_code == 404


def test_library_persists(tmp_path: Path) -> None:
    """Thư viện còn nguyên sau khi khởi động lại helper."""
    settings = Settings(data_dir=tmp_path)
    with TestClient(create_app(settings)) as first:
        _add_track(first)
    with TestClient(create_app(settings)) as second:
        assert len(second.get("/api/tracks").json()["tracks"]) == 1
