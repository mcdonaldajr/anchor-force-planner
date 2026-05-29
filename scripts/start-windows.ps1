param(
  [int]$Port = 4184,
  [string]$HostAddress = "127.0.0.1",
  [switch]$Lan,
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataDir = Join-Path $projectRoot "data"
$logDir = Join-Path $dataDir "logs"
$pidFile = Join-Path $dataDir "anchor-force-planner.pid"
$logFile = Join-Path $logDir "server-windows.log"
$errFile = Join-Path $logDir "server-windows.err.log"
$launcherLogFile = Join-Path $logDir "server-windows-launcher.log"
$serverFile = Join-Path $projectRoot "server.mjs"

if ($Lan) {
  $HostAddress = "0.0.0.0"
}

New-Item -ItemType Directory -Force -Path $dataDir, $logDir | Out-Null

if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existingPid) {
    $existingProcess = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
    $existingCommand = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
    if ($existingProcess -and $existingCommand.CommandLine -like "*server.mjs*") {
      Write-Host "Anchor Force Planner is already running as PID $existingPid."
      Write-Host "Open http://127.0.0.1:$Port"
      if ($OpenBrowser) {
        Start-Process "http://127.0.0.1:$Port"
      }
      exit 0
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js was not found. Install Node.js LTS from https://nodejs.org/ and reopen PowerShell."
}

$oldPort = $env:PORT
$oldHost = $env:HOST
$env:PORT = [string]$Port
$env:HOST = $HostAddress
try {
  $process = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @("`"$serverFile`"") `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errFile `
    -WindowStyle Hidden `
    -PassThru
} finally {
  $env:PORT = $oldPort
  $env:HOST = $oldHost
}

$process.Id | Set-Content -Path $pidFile -Encoding ascii
"$(Get-Date -Format s) Started Anchor Force Planner PID $($process.Id) on $HostAddress`:$Port" | Add-Content -Path $launcherLogFile

Write-Host "Anchor Force Planner started as PID $($process.Id)."
Write-Host "Local URL: http://127.0.0.1:$Port"
if ($Lan) {
  Write-Host "LAN mode is enabled. Use this Windows machine's Wi-Fi/LAN address with port $Port from another device."
}
Write-Host "Logs: $logFile"

if ($OpenBrowser) {
  Start-Process "http://127.0.0.1:$Port"
}
