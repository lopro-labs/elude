# Downloads the OSM extract (OSM_PBF_URL from .env or the default sample region) into ./data/region.osm.pbf
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$url = 'https://download.geofabrik.de/north-america/us/delaware-latest.osm.pbf'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*OSM_PBF_URL\s*=' } | Select-Object -Last 1
  if ($line) { $url = ($line -split '=', 2)[1].Trim() }
}
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$dest = Join-Path $dataDir 'region.osm.pbf'
if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) {
  Write-Host "Already present: $dest"
  exit 0
}
Write-Host "Downloading $url -> $dest"
$tmp = "$dest.part"
curl.exe -fL --retry 5 --retry-delay 10 -o $tmp $url
Move-Item -Force $tmp $dest
Write-Host "Done."
