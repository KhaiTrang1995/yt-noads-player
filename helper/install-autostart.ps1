# Cho helper tự chạy ẩn mỗi khi đăng nhập Windows (shortcut trong thư mục Startup).
# Gỡ: xóa "YT NoAds Helper.lnk" trong shell:startup.
$ErrorActionPreference = "Stop"
$helper = $PSScriptRoot
$pythonw = Join-Path $helper ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pythonw)) {
    python -m venv (Join-Path $helper ".venv")
    & (Join-Path $helper ".venv\Scripts\python.exe") -m pip install -r (Join-Path $helper "requirements.txt")
}
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "YT NoAds Helper.lnk"
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $pythonw
$sc.Arguments = "-m app"
$sc.WorkingDirectory = $helper
$sc.Description = "YT NoAds Player helper (127.0.0.1:8765)"
$sc.Save()
Write-Output "Da tao: $lnk"
