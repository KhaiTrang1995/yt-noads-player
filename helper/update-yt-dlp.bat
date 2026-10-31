@echo off
rem YouTube doi API thuong xuyen - neu tai loi, chay file nay de cap nhat yt-dlp
cd /d "%~dp0"
.venv\Scripts\python -m pip install -U "yt-dlp[default]"
pause
