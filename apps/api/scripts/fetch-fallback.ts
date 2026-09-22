/**
 * Build the bundled fallback camera snapshot (apps/api/data/cameras.fallback.geojson)
 * for REGION_BBOX. Keeps only a handful of tags to keep the file small.
 *
 *   npx tsx scripts/fetch-fallback.ts                # query Overpass
 *   npx tsx scripts/fetch-fallback.ts --from raw.json # convert a saved Overpass JSON response
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CameraFeature } from '@elude/shared';
import { config } from '../src/config.js';
import { elementToFeature, fetchCameras, type OverpassResponse } from '../src/cameras/overpass.js';

const KEEP_TAGS = ['manufacturer', 'operator', 'direction', 'camera:direction', 'surveillance:zone', 'brand'];

function trim(f: CameraFeature): CameraFeature {
  const tags: Record<string, string> = {};
  for (const k of KEEP_TAGS) {
    const v = f.properties.tags[k];
    if (v !== undefined) tags[k] = v;
  }
  const props: CameraFeature['properties'] = { id: f.properties.id, osmType: f.properties.osmType, tags };
  if (f.properties.manufacturer) props.manufacturer = f.properties.manufacturer;
  if (f.properties.operator) props.operator = f.properties.operator;
  if (f.properties.direction !== undefined) props.direction = f.properties.direction;
  if (f.properties.timestamp) props.timestamp = f.properties.timestamp;
  return {
    type: 'Feature',
    id: f.id,
    geometry: {
      type: 'Point',
      coordinates: [
        Math.round(f.geometry.coordinates[0]! * 1e7) / 1e7,
        Math.round(f.geometry.coordinates[1]! * 1e7) / 1e7,
      ],
    },
    properties: props,
  };
}

async function main(): Promise<void> {
  const fromIdx = process.argv.indexOf('--from');
  let features: CameraFeature[];
  if (fromIdx !== -1) {
    const raw = JSON.parse(await fs.readFile(process.argv[fromIdx + 1]!, 'utf8')) as OverpassResponse;
    features = raw.elements.map(elementToFeature).filter((f): f is CameraFeature => f !== null);
  } else {
    ({ features } = await fetchCameras(config.regionBbox, { log: (m) => console.log(m) }));
  }
  const trimmed = features.map(trim);
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/cameras.fallback.geojson');
  await fs.mkdir(path.dirname(out), { recursive: true });
  const body = {
    type: 'FeatureCollection',
    fetchedAt: new Date().toISOString(),
    source: 'fallback',
    regionBbox: config.regionBbox,
    features: trimmed,
  };
  await fs.writeFile(out, JSON.stringify(body));
  const stat = await fs.stat(out);
  console.log(`wrote ${trimmed.length} cameras to ${out} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
