"""Chặn trang web bất kỳ gọi ngược vào helper localhost (CSRF tới 127.0.0.1).

Chỉ cho phép request không có Origin (curl, thẻ <audio> cùng origin) hoặc Origin là
trang của extension. Helper chỉ bind 127.0.0.1 nên máy khác trong LAN không gọi được.
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

ALLOWED_ORIGIN_SCHEMES = ("chrome-extension://", "moz-extension://", "extension://")


class ExtensionOriginMiddleware(BaseHTTPMiddleware):
    """Từ chối request mang Origin không phải extension."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        origin = request.headers.get("origin")
        if origin and origin != "null" and not origin.startswith(ALLOWED_ORIGIN_SCHEMES):
            logger.warning("Chặn request từ origin lạ: %s %s", origin, request.url.path)
            return JSONResponse(status_code=403, content={"detail": "Origin không được phép"})
        response = await call_next(request)
        if origin and origin.startswith(ALLOWED_ORIGIN_SCHEMES):
            # Cho <audio crossorigin> của extension đọc dữ liệu → hiệu ứng visualizer (Web Audio).
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        return response
