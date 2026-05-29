$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataDir = Join-Path $projectRoot "data"
$logDir = Join-Path $dataDir "logs"
$pidFile = Join-Path $dataDir "anchor-force-planner.pid"
$launcherLogFile = Join-Path $logDir "server-windows-launcher.log"

if (-not (Test-Path $pidFile)) {
  Write-Host "No Anchor Force Planner PID file found. The server is probably not running."
  exit 0
}

$pidText = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pidText) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Empty PID file removed."
  exit 0
}

$process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Stored PID $pidText is not running. PID file removed."
  exit 0
}

$command = Get-CimInstance Win32_Process -Filter "ProcessId = $pidText" -ErrorAction SilentlyContinue
if (-not $command.CommandLine -or $command.CommandLine -notlike "*server.mjs*") {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Stored PID $pidText does not look like Anchor Force Planner. PID file removed without stopping anything."
  exit 1
}

Stop-Process -Id $process.Id -Force
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
"$(Get-Date -Format s) Stopped Anchor Force Planner PID $pidText" | Add-Content -Path $launcherLogFile
Write-Host "Anchor Force Planner stopped."
