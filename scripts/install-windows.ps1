param(
  [switch]$CreateDesktopShortcuts,
  [switch]$LanShortcuts
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataDir = Join-Path $projectRoot "data"
$cacheDir = Join-Path $dataDir "cache"
$logDir = Join-Path $dataDir "logs"

Write-Host "Installing Anchor Force Planner for Windows..."
Write-Host "Project: $projectRoot"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js was not found. Install Node.js LTS from https://nodejs.org/ and reopen PowerShell."
}

New-Item -ItemType Directory -Force -Path $dataDir, $cacheDir, $logDir | Out-Null

if ($CreateDesktopShortcuts) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shell = New-Object -ComObject WScript.Shell
  $powershell = (Get-Command powershell.exe).Source

  $startArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$projectRoot\scripts\start-windows.ps1`""
  if ($LanShortcuts) {
    $startArgs = "$startArgs -Lan"
  }

  $startShortcut = $shell.CreateShortcut((Join-Path $desktop "Start Anchor Force Planner Server.lnk"))
  $startShortcut.TargetPath = $powershell
  $startShortcut.Arguments = $startArgs
  $startShortcut.WorkingDirectory = $projectRoot
  $startShortcut.Description = "Start the Anchor Force Planner local server"
  $startShortcut.Save()

  $stopShortcut = $shell.CreateShortcut((Join-Path $desktop "Stop Anchor Force Planner Server.lnk"))
  $stopShortcut.TargetPath = $powershell
  $stopShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$projectRoot\scripts\stop-windows.ps1`""
  $stopShortcut.WorkingDirectory = $projectRoot
  $stopShortcut.Description = "Stop the Anchor Force Planner local server"
  $stopShortcut.Save()

  Write-Host "Created desktop shortcuts."
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Start with:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-windows.ps1"
Write-Host ""
Write-Host "Then open:"
Write-Host "  http://127.0.0.1:4184"
