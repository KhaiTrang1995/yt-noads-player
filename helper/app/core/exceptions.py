"""Exception nghiệp vụ + handler trả JSON gọn, không lộ stack trace."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class NotFoundError(Exception):
    """Không tìm thấy bài trong thư viện."""

    def __init__(self, entity: str, entity_id: str) -> None:
        super().__init__(f"{entity} {entity_id} not found")
        self.entity = entity
        self.entity_id = entity_id


class ResolveError(Exception):
    """Không đọc được link (sai link, video riêng tư, bị chặn...)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def register_exception_handlers(app: FastAPI) -> None:
    """Gắn các handler vào app."""

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": f"Không tìm thấy {exc.entity}"})

    @app.exception_handler(ResolveError)
    async def _resolve(_: Request, exc: ResolveError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Lỗi không mong đợi: %s", exc)
        return JSONResponse(status_code=500, content={"detail": "Lỗi nội bộ helper"})
