"""Pydantic DTO cho bài hát, yêu cầu tải và hàng đợi tải."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator


class MediaMode(StrEnum):
    """Kiểu tải: chỉ âm thanh (nghe) hoặc video (xem)."""

    AUDIO = "audio"
    VIDEO = "video"


class JobStatus(StrEnum):
    """Trạng thái một lượt tải."""

    QUEUED = "queued"
    DOWNLOADING = "downloading"
    DONE = "done"
    ERROR = "error"


class Track(BaseModel):
    """Một bài đã tải xong, nằm trong thư viện."""

    id: str
    source_id: str
    source_url: str
    title: str
    artist: str = ""
    duration: float | None = None
    thumbnail: str | None = None
    mode: MediaMode
    filename: str
    added_at: datetime


class AddRequest(BaseModel):
    """Yêu cầu thêm nhạc từ link video, playlist hoặc URL file trực tiếp."""

    url: str = Field(min_length=8, max_length=2048)
    mode: MediaMode = MediaMode.AUDIO

    @field_validator("url")
    @classmethod
    def _must_be_http(cls, value: str) -> str:
        value = value.strip()
        if not value.lower().startswith(("http://", "https://")):
            raise ValueError("Link phải bắt đầu bằng http:// hoặc https://")
        return value


class AddResponse(BaseModel):
    """Kết quả xếp hàng tải."""

    queued: int
    skipped: int
    message: str


class Job(BaseModel):
    """Một lượt tải trong hàng đợi."""

    id: str
    url: str
    title: str
    mode: MediaMode
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    error: str | None = None
    track_id: str | None = None


class DownloadsResponse(BaseModel):
    """Danh sách lượt tải đang chạy và vừa xong."""

    running: int
    jobs: list[Job]
    library_version: int


class TracksResponse(BaseModel):
    """Toàn bộ thư viện."""

    tracks: list[Track]
    library_version: int


class HealthResponse(BaseModel):
    """Thông tin sống của helper."""

    ok: bool
    version: str
    yt_dlp: str
    ffmpeg: bool
    data_dir: str
