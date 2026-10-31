@echo off
rem Chay helper YT NoAds Player (lan dau tu tao venv + cai thu vien)
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo [setup] Tao moi truong Python...
  python -m venv .venv || goto :err
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt || goto :err
)
echo Helper dang chay tai http://127.0.0.1:8765  (dong cua so nay de tat)
.venv\Scripts\python -m app
goto :eof
:err
echo Loi cai dat. Can Python 3.11+ trong PATH.
pause
