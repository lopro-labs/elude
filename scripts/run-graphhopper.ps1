# Runs GraphHopper natively (needs Java 17+). Downloads the GraphHopper jar on first use.
# Usage: scripts/run-graphhopper.ps1 [-Import]   (-Import builds the graph cache and exits)
param([switch]$Import)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ghVersion = '11.0'
$jar = Join-Path $root "data/graphhopper-web-$ghVersion.jar"
$pbf = Join-Path $root 'data/region.osm.pbf'
$cache = Join-Path $root 'data/graph-cache'
$config = Join-Path $root 'graphhopper/config.yml'
$javaOpts = if ($env:JAVA_OPTS) { $env:JAVA_OPTS } else { '-Xmx6g -Xms2g' }

if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'java not found on PATH (Java 17+ required)' }
$ver = (& java -version 2>&1 | Select-Object -First 1)
Write-Host "Using $ver"

if (-not (Test-Path $pbf)) { & (Join-Path $PSScriptRoot 'fetch-osm.ps1') }
if (-not (Test-Path $jar)) {
  $url = "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/$ghVersion/graphhopper-web-$ghVersion.jar"
  Write-Host "Downloading GraphHopper $ghVersion -> $jar"
  curl.exe -fL -o "$jar.part" $url
  Move-Item -Force "$jar.part" $jar
}
$action = if ($Import) { 'import' } else { 'server' }
Write-Host "Starting GraphHopper ($action) with JAVA_OPTS=$javaOpts"
Push-Location $root
try {
  & java $javaOpts.Split(' ') "-Ddw.graphhopper.datareader.file=$pbf" "-Ddw.graphhopper.graph.location=$cache" -jar $jar $action $config
} finally { Pop-Location }
