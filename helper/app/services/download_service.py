"""Hàng đợi tải bằng yt-dlp: đọc link → xếp hàng → tải song song → ghi thư viện."""

import asyncio
import logging
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yt_dlp
from yt_dlp.utils import DownloadError

from app.config import Settings
from app.core.exceptions import ResolveError
from app.repositories.library_repo import LibraryRepository, make_track_id
from app.schemas.track_schema import AddRequest, AddResponse, Job, JobStatus, MediaMode, Track

logger = logging.getLogger(__name__)

MAX_FINISHED_JOBS = 20
UNAVAILABLE_TITLES = {"[Private video]", "[Deleted video]", "[Unavailable video]"}
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


@dataclass(frozen=True)
class _Entry:
    """Một video đã đọc ra từ link (link lẻ hoặc phần tử playlist)."""

    source_id: str
    url: str
    title: str


class _QuietLogger:
    """Chuyển log của yt-dlp sang logging, bỏ bớt dòng debug."""

    def debug(self, msg: str) -> None:
        """Bỏ qua debug của yt-dlp."""

    def info(self, msg: str) -> None:
        """Bỏ qua info của yt-dlp."""

    def warning(self, msg: str) -> None:
        """Ghi cảnh báo của yt-dlp."""
        logger.debug("yt-dlp: %s", msg)

    def error(self, msg: str) -> None:
        """Ghi lỗi của yt-dlp."""
        logger.warning("yt-dlp: %s", _ANSI.sub("", msg))


class DownloadService:
    """Quản lý lượt tải; worker chạy yt-dlp trong thread để không chặn event loop."""

    def __init__(self, settings: Settings, repo: LibraryRepository) -> None:
        self._settings = settings
        self._repo = repo
        self._jobs: dict[str, Job] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._workers: list[asyncio.Task[None]] = []
        self.ffmpeg_path = shutil.which("ffmpeg")
        runtimes = {name: {} for name in ("deno", "node", "bun") if shutil.which(name)}
        self._js_runtimes: dict[str, dict[str, Any]] = runtimes or {"deno": {}}

    async def start(self) -> None:
        """Bật các worker tải."""
        self._settings.media_dir.mkdir(parents=True, exist_ok=True)
        for _ in range(self._settings.max_parallel_downloads):
            self._workers.append(asyncio.create_task(self._worker()))
        logger.info(
            "Helper sẵn sàng — ffmpeg: %s, JS runtime: %s",
            self.ffmpeg_path or "không có",
            ", ".join(self._js_runtimes),
        )

    async def stop(self) -> None:
        """Dừng worker khi tắt helper."""
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)

    @property
    def running(self) -> int:
        """Số lượt đang chờ hoặc đang tải."""
        return sum(j.status in (JobStatus.QUEUED, JobStatus.DOWNLOADING) for j in self._jobs.values())

    def jobs(self) -> list[Job]:
        """Mọi lượt tải còn giữ, cũ trước mới sau."""
        return list(self._jobs.values())

    async def enqueue(self, request: AddRequest) -> AddResponse:
        """Đọc link (có thể là playlist) rồi xếp từng video vào hàng đợi."""
        entries = await asyncio.to_thread(self._resolve, request.url)
        busy = {
            (j.url, j.mode) for j in self._jobs.values()
            if j.status in (JobStatus.QUEUED, JobStatus.DOWNLOADING)
        }
        queued = skipped = 0
        for entry in entries:
            if self._repo.has(entry.source_id, request.mode) or (entry.url, request.mode) in busy:
                skipped += 1
                continue
            job = Job(id=uuid.uuid4().hex[:12], url=entry.url, title=entry.title, mode=request.mode)
            self._jobs[job.id] = job
            await self._queue.put(job.id)
            queued += 1
        if queued:
            message = f"Đã xếp hàng {queued} bài." + (f" Bỏ qua {skipped} bài đã có." if skipped else "")
        else:
            message = "Các bài này đã có trong thư viện." if skipped else "Không tìm thấy bài nào trong link."
        logger.info("Thêm link: %d xếp hàng, %d bỏ qua", queued, skipped)
        return AddResponse(queued=queued, skipped=skipped, message=message)

    def _base_opts(self) -> dict[str, Any]:
        """Tùy chọn yt-dlp dùng chung."""
        opts: dict[str, Any] = {
            "quiet": True,
            "noprogress": True,
            "noplaylist": True,
            "logger": _QuietLogger(),
            "js_runtimes": self._js_runtimes,
            "retries": 3,
            "fragment_retries": 3,
        }
        if self.ffmpeg_path:
            opts["ffmpeg_location"] = self.ffmpeg_path
        return opts

    def _resolve(self, url: str) -> list[_Entry]:
        """Đọc metadata nhanh (không tải) để biết link có những video nào."""
        opts = self._base_opts() | {
            "extract_flat": "in_playlist",
            "playlistend": self._settings.max_playlist_items,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as exc:
            raise ResolveError(_clean_error(exc)) from exc
        if not info:
            raise ResolveError("Link không có nội dung tải được")

        if info.get("_type") == "playlist":
            entries = []
            for item in info.get("entries") or []:
                if not item or item.get("title") in UNAVAILABLE_TITLES:
                    continue
                item_url = item.get("url") or item.get("webpage_url")
                if not item_url or not item.get("id"):
                    continue
                if not item_url.startswith("http"):
                    item_url = f"https://www.youtube.com/watch?v={item['id']}"
                entries.append(_Entry(item["id"], item_url, item.get("title") or item_url))
            return entries

        return [_Entry(info["id"], info.get("webpage_url") or url, info.get("title") or url)]

    async def _worker(self) -> None:
        """Lấy từng lượt trong hàng đợi và tải."""
        while True:
            job_id = await self._queue.get()
            job = self._jobs.get(job_id)
            try:
                if job is not None:
                    job.status = JobStatus.DOWNLOADING
                    track = await asyncio.to_thread(self._download, job)
                    self._repo.add(track)
                    job.track_id = track.id
                    job.title = track.title
                    job.progress = 1.0
                    job.status = JobStatus.DONE
                    logger.info("Tải xong: %s", track.title)
            except DownloadError as exc:
                job.status = JobStatus.ERROR
                job.error = _clean_error(exc)
                logger.warning("Tải lỗi %s: %s", job.url, job.error)
            except Exception as exc:  # giữ worker sống dù lỗi lạ
                if job is not None:
                    job.status = JobStatus.ERROR
                    job.error = "Lỗi không xác định khi tải"
                logger.exception("Lỗi khi tải %s: %s", job_id, exc)
            finally:
                self._queue.task_done()
                self._prune()

    def _download(self, job: Job) -> Track:
        """Tải một video bằng yt-dlp (chạy trong thread)."""
        media_dir = self._settings.media_dir
        height = self._settings.max_video_height
        parts_done = 0
        merge = job.mode is MediaMode.VIDEO and self.ffmpeg_path is not None
        expected_parts = 2 if merge else 1

        def on_progress(d: dict[str, Any]) -> None:
            nonlocal parts_done
            if d.get("status") == "finished":
                parts_done += 1
                frac = 0.0
            else:
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                frac = (d.get("downloaded_bytes") or 0) / total if total else 0.0
            job.progress = min(0.99, max(job.progress, (parts_done + frac) / expected_parts))

        if job.mode is MediaMode.AUDIO:
            fmt = "bestaudio[ext=m4a]/bestaudio[acodec=opus]/bestaudio/best"
        elif merge:
            fmt = (
                f"bv*[height<={height}][ext=mp4]+ba[ext=m4a]/"
                f"b[height<={height}][ext=mp4]/b[height<={height}]/b"
            )
        else:
            fmt = f"b[height<={height}][ext=mp4]/b[ext=mp4]/b"

        placeholder = f"{uuid.uuid4().hex[:8]}-{job.mode.value}"
        opts = self._base_opts() | {
            "format": fmt,
            "outtmpl": str(media_dir / f"{placeholder}.%(ext)s"),
            "progress_hooks": [on_progress],
            "merge_output_format": "mp4",
            "concurrent_fragment_downloads": 4,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(job.url, download=True)

        downloaded = Path(info["requested_downloads"][0]["filepath"])
        track_id = make_track_id(info["id"], job.mode)
        final = media_dir / f"{track_id}{downloaded.suffix}"
        downloaded.replace(final)

        return Track(
            id=track_id,
            source_id=info["id"],
            source_url=info.get("webpage_url") or job.url,
            title=info.get("track") or info.get("title") or job.title,
            artist=info.get("artist") or info.get("creator") or info.get("uploader") or info.get("channel") or "",
            duration=info.get("duration"),
            thumbnail=info.get("thumbnail"),
            mode=job.mode,
            filename=final.name,
            added_at=datetime.now(UTC),
        )

    def _prune(self) -> None:
        """Chỉ giữ MAX_FINISHED_JOBS lượt đã xong/lỗi gần nhất."""
        finished = [j.id for j in self._jobs.values() if j.status in (JobStatus.DONE, JobStatus.ERROR)]
        for job_id in finished[:-MAX_FINISHED_JOBS]:
            self._jobs.pop(job_id, None)


def _clean_error(exc: Exception) -> str:
    """Rút gọn thông báo lỗi yt-dlp cho người dùng đọc."""
    text = _ANSI.sub("", str(exc)).replace("ERROR: ", "")
    text = re.sub(r"^\[[^\]]+\] [\w-]+: ", "", text)
    return text.splitlines()[0][:200] if text else "Không tải được"
