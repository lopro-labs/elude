#!/usr/bin/env bash
# Downloads the OSM extract (OSM_PBF_URL from .env or the default sample region) into ./data/region.osm.pbf
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="https://download.geofabrik.de/north-america/us/delaware-latest.osm.pbf"
if [ -f "$ROOT/.env" ]; then
  V=$(grep -E '^\s*OSM_PBF_URL\s*=' "$ROOT/.env" | tail -n1 | cut -d= -f2- | xargs || true)
  [ -n "${V:-}" ] && URL="$V"
fi
mkdir -p "$ROOT/data"
DEST="$ROOT/data/region.osm.pbf"
if [ -s "$DEST" ]; then echo "Already present: $DEST"; exit 0; fi
echo "Downloading $URL -> $DEST"
curl -fL --retry 5 --retry-delay 10 -o "$DEST.part" "$URL"
mv "$DEST.part" "$DEST"
echo "Done."
