"""Depends() factory — service/repo được tạo trong lifespan và gắn vào app.state."""

from fastapi import Request

from app.repositories.library_repo import LibraryRepository
from app.services.download_service import DownloadService


def get_repo(request: Request) -> LibraryRepository:
    """Repo thư viện dùng chung."""
    return request.app.state.repo


def get_downloads(request: Request) -> DownloadService:
    """Service tải dùng chung."""
    return request.app.state.downloads
