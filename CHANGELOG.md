# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [1.2.0] — 2026-10-31
### Added
- Floating mini player injected on YouTube pages: draggable panel, spinning vinyl,
  audio-reactive visualizer ring (Web Audio), ambient background from cover art, marquee titles.
- "Video on this page" card: one click to download as audio/video, auto-plays when done.
- Mini player pauses YouTube's own video (incl. autoplaying ads) while it plays.
- English / Vietnamese locales for extension name, description, menus.
- Helper sends CORS headers to extension origins so the visualizer can read audio data.

## [1.1.0] — 2026-10-30
### Added
- Toolbar popup: add the open YouTube video (listen/watch), progress, "Play now".
- `install-autostart.ps1`: run the helper hidden at Windows sign-in; logs to `helper.log`.

## [1.0.0] — 2026-10-30
### Added
- Full-tab player (vinyl UI, seek, prev/next, auto-continue, Media Session keys).
- Library: add video / playlist / mp3 URL, download queue with progress, search, delete.
- Right-click menu and `Alt+Shift+A` shortcut.
- Local helper (FastAPI + yt-dlp): download queue, JSON library, range-enabled media streaming,
  origin check against CSRF from websites.
