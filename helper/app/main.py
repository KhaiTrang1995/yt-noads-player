"""FastAPI app của helper YT NoAds Player."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from yt_dlp.version import __version__ as yt_dlp_version

from app.config import Settings, get_settings
from app.core.dependencies import get_downloads
from app.core.exceptions import register_exception_handlers
from app.core.security import ExtensionOriginMiddleware
from app.repositories.library_repo import LibraryRepository
from app.routers import downloads_router, library_router
from app.schemas.track_schema import HealthResponse
from app.services.download_service import DownloadService

APP_VERSION = "1.0.0"
logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Tạo app; test truyền Settings riêng để dùng thư mục tạm."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.media_dir.mkdir(parents=True, exist_ok=True)
        app.state.repo = LibraryRepository(settings.library_file, settings.media_dir)
        app.state.downloads = DownloadService(settings, app.state.repo)
        await app.state.downloads.start()
        logger.info("Dữ liệu lưu tại %s", settings.data_dir)
        yield
        await app.state.downloads.stop()

    app = FastAPI(title="YT NoAds Player helper", version=APP_VERSION, lifespan=lifespan)
    app.add_middleware(ExtensionOriginMiddleware)
    register_exception_handlers(app)
    app.include_router(library_router.router)
    app.include_router(downloads_router.router)

    @app.get("/api/health", tags=["health"])
    async def health(
        service: Annotated[DownloadService, Depends(get_downloads)],
    ) -> HealthResponse:
        """Extension gọi để biết helper đang chạy."""
        return HealthResponse(
            ok=True,
            version=APP_VERSION,
            yt_dlp=yt_dlp_version,
            ffmpeg=service.ffmpeg_path is not None,
            data_dir=str(settings.data_dir),
        )

    return app
