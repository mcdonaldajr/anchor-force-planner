param(
  [int]$Port = 4184
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidFile = Join-Path $projectRoot "data\anchor-force-planner.pid"
$logFile = Join-Path $projectRoot "data\logs\server-windows.log"
$errFile = Join-Path $projectRoot "data\logs\server-windows.err.log"

if (-not (Test-Path $pidFile)) {
  Write-Host "Anchor Force Planner is not running: no PID file."
  exit 1
}

$pidText = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
$process = if ($pidText) { Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue } else { $null }

if (-not $process) {
  Write-Host "Anchor Force Planner is not running: stored PID $pidText was not found."
  exit 1
}

$command = Get-CimInstance Win32_Process -Filter "ProcessId = $pidText" -ErrorAction SilentlyContinue
if (-not $command.CommandLine -or $command.CommandLine -notlike "*server.mjs*") {
  Write-Host "Anchor Force Planner is not running: stored PID $pidText belongs to another process."
  exit 1
}

Write-Host "Anchor Force Planner is running."
Write-Host "PID: $($process.Id)"
Write-Host "URL: http://127.0.0.1:$Port"
Write-Host "Log: $logFile"
Write-Host "Error log: $errFile"
