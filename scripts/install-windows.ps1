$ErrorActionPreference = "Stop"

$AppName = "Anchor Force Planner"
$AppDir = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $AppDir "scripts\start-windows.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "$AppName.lnk"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js and npm are required."
  Write-Host "Install Node.js LTS from https://nodejs.org/ then run this installer again."
  exit 1
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,220"
$Shortcut.Description = "Run the local Anchor Force Planner web app"
$Shortcut.Save()

Write-Host "Installed desktop launcher: $ShortcutPath"
Write-Host "Double-click it to start the app, then open http://127.0.0.1:4184"
