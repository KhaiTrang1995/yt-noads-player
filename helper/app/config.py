"""Cấu hình helper — đọc từ biến môi trường tiền tố YTP_ hoặc file .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Thiết lập chạy helper local."""

    model_config = SettingsConfigDict(env_prefix="YTP_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=1024, le=65535)
    data_dir: Path = Path.home() / "YTNoAdsPlayer"
    max_parallel_downloads: int = Field(default=2, ge=1, le=6)
    max_video_height: int = Field(default=720, ge=144, le=2160)
    max_playlist_items: int = Field(default=200, ge=1, le=2000)

    @property
    def media_dir(self) -> Path:
        """Thư mục chứa file audio/video đã tải."""
        return self.data_dir / "media"

    @property
    def library_file(self) -> Path:
        """File JSON lưu danh sách bài trong thư viện."""
        return self.data_dir / "library.json"


@lru_cache
def get_settings() -> Settings:
    """Settings dùng chung toàn app."""
    return Settings()
