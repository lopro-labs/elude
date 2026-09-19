#!/usr/bin/env bash
# Runs GraphHopper natively (needs Java 17+). Downloads the GraphHopper jar on first use.
# Usage: scripts/run-graphhopper.sh [--import]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GH_VERSION=11.0
JAR="$ROOT/data/graphhopper-web-$GH_VERSION.jar"
PBF="$ROOT/data/region.osm.pbf"
CACHE="$ROOT/data/graph-cache"
CONFIG="$ROOT/graphhopper/config.yml"
JAVA_OPTS="${JAVA_OPTS:--Xmx6g -Xms2g}"
ACTION=server
[ "${1:-}" = "--import" ] && ACTION=import
command -v java >/dev/null || { echo "java not found (Java 17+ required)"; exit 1; }
[ -s "$PBF" ] || "$ROOT/scripts/fetch-osm.sh"
if [ ! -s "$JAR" ]; then
  echo "Downloading GraphHopper $GH_VERSION"
  curl -fL -o "$JAR.part" "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/$GH_VERSION/graphhopper-web-$GH_VERSION.jar"
  mv "$JAR.part" "$JAR"
fi
cd "$ROOT"
exec java $JAVA_OPTS -Ddw.graphhopper.datareader.file="$PBF" -Ddw.graphhopper.graph.location="$CACHE" -jar "$JAR" $ACTION "$CONFIG"
