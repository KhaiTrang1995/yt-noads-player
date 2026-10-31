"""Lưu thư viện vào một file JSON — đủ cho vài nghìn bài, không cần DB."""

import json
import logging
import threading
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.track_schema import MediaMode, Track

logger = logging.getLogger(__name__)


class LibraryRepository:
    """Truy cập danh sách bài, an toàn khi nhiều thread tải cùng ghi."""

    def __init__(self, library_file: Path, media_dir: Path) -> None:
        self._file = library_file
        self._media_dir = media_dir
        self._lock = threading.Lock()
        self._tracks: dict[str, Track] = {}
        self.version = 0
        self._load()

    def _load(self) -> None:
        """Đọc file JSON lúc khởi động; bỏ qua bài mà file media đã mất."""
        if not self._file.exists():
            return
        try:
            raw = json.loads(self._file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("Không đọc được %s: %s — bắt đầu thư viện trống", self._file, exc)
            return
        for item in raw.get("tracks", []):
            track = Track.model_validate(item)
            if (self._media_dir / track.filename).exists():
                self._tracks[track.id] = track
        logger.info("Đã nạp %d bài từ thư viện", len(self._tracks))

    def _save(self) -> None:
        """Ghi file tạm rồi thay thế để không hỏng JSON khi tắt đột ngột."""
        payload = {"tracks": [t.model_dump(mode="json") for t in self._tracks.values()]}
        tmp = self._file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self._file)
        self.version += 1

    def list(self) -> list[Track]:
        """Mọi bài, mới thêm lên đầu."""
        with self._lock:
            return sorted(self._tracks.values(), key=lambda t: t.added_at, reverse=True)

    def get(self, track_id: str) -> Track:
        """Một bài theo id."""
        with self._lock:
            track = self._tracks.get(track_id)
        if track is None:
            raise NotFoundError("bài", track_id)
        return track

    def has(self, source_id: str, mode: MediaMode) -> bool:
        """Bài này (cùng kiểu tải) đã có trong thư viện chưa."""
        with self._lock:
            return make_track_id(source_id, mode) in self._tracks

    def add(self, track: Track) -> None:
        """Thêm hoặc ghi đè một bài."""
        with self._lock:
            self._tracks[track.id] = track
            self._save()

    def delete(self, track_id: str) -> Track:
        """Xóa bài khỏi thư viện và xóa file media."""
        with self._lock:
            track = self._tracks.pop(track_id, None)
            if track is None:
                raise NotFoundError("bài", track_id)
            self._save()
        (self._media_dir / track.filename).unlink(missing_ok=True)
        return track

    def media_path(self, track_id: str) -> Path:
        """Đường dẫn file media của bài."""
        return self._media_dir / self.get(track_id).filename


def make_track_id(source_id: str, mode: MediaMode) -> str:
    """Id ổn định: cùng video có thể có 1 bản nghe + 1 bản xem."""
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in source_id)[:80]
    return f"{safe}-{mode.value}"
