# Elude — bring the whole stack up after a reboot (or any time).
#
#   pwsh -File scripts/start.ps1
#
# All app services run in Docker Compose (project "elude"): graphhopper, api,
# web. There is NO native background process to start — the API lives in the
# elude-api-1 container. Services use `restart: unless-stopped`, so they usually
# come back on their own once Docker Desktop is running; this script just makes
# that reliable and reports health.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Test-Docker {
    try { docker info *> $null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

if (-not (Test-Docker)) {
    Write-Host 'Docker not responding — starting Docker Desktop...' -ForegroundColor Yellow
    $dd = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) { Start-Process $dd } else { Write-Warning "Docker Desktop not found at $dd — start it manually." }
    Write-Host 'Waiting for the Docker engine (up to 3 min)...'
    $deadline = (Get-Date).AddMinutes(3)
    while (-not (Test-Docker)) {
        if ((Get-Date) -gt $deadline) { throw 'Docker did not become ready in time. Start Docker Desktop and re-run.' }
        Start-Sleep -Seconds 5
    }
}

Write-Host 'Bringing up the elude stack...' -ForegroundColor Cyan
# Never touch the user's other containers; only this project's services.
docker compose up -d

Write-Host ''
Write-Host 'GraphHopper loads its graph from cache (~20s). Waiting for health...'
$want = 'graphhopper', 'api', 'web'
$deadline = (Get-Date).AddMinutes(5)
while ($true) {
    Start-Sleep -Seconds 5
    # One "service|status" line per app service; ready when every one reports healthy.
    $lines = docker compose ps --format '{{.Service}}|{{.Status}}' 2>$null
    $ready = $true
    foreach ($svc in $want) {
        $line = $lines | Where-Object { $_ -like "$svc|*" } | Select-Object -First 1
        if (-not $line -or $line -notmatch 'healthy') { $ready = $false }
    }
    if ($ready) { break }
    if ((Get-Date) -gt $deadline) { Write-Warning 'Timed out waiting for health; check `docker compose ps`.'; break }
}

Write-Host ''
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
Write-Host ''
Write-Host 'Elude is up:  http://localhost:8080' -ForegroundColor Green
Write-Host 'API health :  http://localhost:3210/api/health'
