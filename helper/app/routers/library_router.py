"""Endpoint thư viện: liệt kê, xóa, phát file media."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse

from app.core.dependencies import get_repo
from app.repositories.library_repo import LibraryRepository
from app.schemas.track_schema import TracksResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["library"])

RepoDep = Annotated[LibraryRepository, Depends(get_repo)]

MEDIA_TYPES = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
}


@router.get("/api/tracks")
async def list_tracks(repo: RepoDep) -> TracksResponse:
    """Toàn bộ bài trong thư viện, mới nhất trước."""
    return TracksResponse(tracks=repo.list(), library_version=repo.version)


@router.delete("/api/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_track(track_id: str, repo: RepoDep) -> None:
    """Xóa bài và file media của nó."""
    track = repo.delete(track_id)
    logger.info("Đã xóa: %s", track.title)


@router.get("/media/{track_id}")
async def stream_media(track_id: str, repo: RepoDep) -> FileResponse:
    """Phát file (hỗ trợ Range để tua)."""
    track = repo.get(track_id)
    path = repo.media_path(track_id)
    suffix = path.suffix.lower()
    if suffix == ".webm":
        media_type = "video/webm" if track.mode == "video" else "audio/webm"
    else:
        media_type = MEDIA_TYPES.get(suffix, "application/octet-stream")
    return FileResponse(path, media_type=media_type)
