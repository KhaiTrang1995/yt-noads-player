"""Chạy helper: python -m app (hoặc pythonw -m app để chạy ẩn khi khởi động Windows)."""

import logging
import sys

import uvicorn

from app.config import get_settings
from app.main import create_app


def main() -> None:
    """Khởi động uvicorn chỉ trên 127.0.0.1."""
    settings = get_settings()
    if sys.stderr is None:
        # pythonw không có console → ghi log ra file trong thư mục dữ liệu
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        log = (settings.data_dir / "helper.log").open("a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
