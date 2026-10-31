"""Endpoint hàng đợi tải."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.dependencies import get_downloads, get_repo
from app.repositories.library_repo import LibraryRepository
from app.schemas.track_schema import AddRequest, AddResponse, DownloadsResponse
from app.services.download_service import DownloadService

router = APIRouter(prefix="/api/downloads", tags=["downloads"])

ServiceDep = Annotated[DownloadService, Depends(get_downloads)]
RepoDep = Annotated[LibraryRepository, Depends(get_repo)]


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def add_download(request: AddRequest, service: ServiceDep) -> AddResponse:
    """Thêm link video / playlist / URL file vào hàng đợi."""
    return await service.enqueue(request)


@router.get("")
async def list_downloads(service: ServiceDep, repo: RepoDep) -> DownloadsResponse:
    """Tiến độ các lượt tải; library_version đổi khi có bài mới để extension tải lại danh sách."""
    return DownloadsResponse(running=service.running, jobs=service.jobs(), library_version=repo.version)
