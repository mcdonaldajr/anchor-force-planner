param(
  [switch]$Lan,
  [int]$Port = 4184
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
Set-Location $AppDir

$env:HOST = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$env:PORT = "$Port"

Write-Host "Starting Anchor Force Planner on port $Port"
Write-Host "Local URL: http://127.0.0.1:$Port"

if ($Lan) {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Host "LAN URL: http://$($_.IPAddress):$Port" }
}

npm start
