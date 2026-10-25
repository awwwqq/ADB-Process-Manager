$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$downloadDirectory = Join-Path $projectRoot '.cache'
$archivePath = Join-Path $downloadDirectory 'platform-tools-windows.zip'
New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
Write-Output 'Downloading Android Platform Tools from Google...'
Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $archivePath
Expand-Archive -LiteralPath $archivePath -DestinationPath $projectRoot -Force
& (Join-Path $projectRoot 'platform-tools\adb.exe') version

