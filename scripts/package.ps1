# Build release archives into dist/:
#   yt-noads-player-extension-<ver>.zip  -> the extension only (for "Load unpacked" after unzip)
#   yt-noads-player-<ver>.zip            -> extension + helper + READMEs (what most users want)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root "extension\manifest.json") -Raw | ConvertFrom-Json).version
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "stage\yt-noads-player"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

Compress-Archive -Path (Join-Path $root "extension\*") -DestinationPath (Join-Path $dist "yt-noads-player-extension-$version.zip")

Copy-Item (Join-Path $root "extension") $stage -Recurse
New-Item -ItemType Directory -Force (Join-Path $stage "helper") | Out-Null
Get-ChildItem (Join-Path $root "helper") -Force |
    Where-Object { $_.Name -notin ".venv", "__pycache__", ".pytest_cache", ".env" } |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $stage "helper") -Recurse }
Get-ChildItem $stage -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
Copy-Item (Join-Path $root "README.md"), (Join-Path $root "README.vi.md"), (Join-Path $root "LICENSE") $stage
Compress-Archive -Path $stage -DestinationPath (Join-Path $dist "yt-noads-player-$version.zip")
Remove-Item (Join-Path $dist "stage") -Recurse -Force

Get-ChildItem $dist | ForEach-Object { "{0}  ({1:N0} KB)" -f $_.Name, ($_.Length / 1KB) }
