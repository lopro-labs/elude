import type { CameraFeature, LngLat } from '@elude/shared';
import type { GHPath } from '../src/routing/graphhopper.js';

let nextId = 1;

export function camera(lngLat: LngLat, manufacturer = 'Flock Safety', id?: number, direction?: number): CameraFeature {
  const cid = id ?? nextId++;
  const feature: CameraFeature = {
    type: 'Feature',
    id: `node/${cid}`,
    geometry: { type: 'Point', coordinates: lngLat },
    properties: { id: cid, osmType: 'node', manufacturer, operator: 'Test PD', tags: { manufacturer } },
  };
  if (direction !== undefined) {
    feature.properties.direction = direction;
    feature.properties.tags['camera:direction'] = String(direction);
  }
  return feature;
}

/** Move a point by dx/dy metres (east/north). */
export function offsetM(p: LngLat, dxM: number, dyM: number): LngLat {
  const dLat = dyM / 111_320;
  const dLon = dxM / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  return [p[0] + dLon, p[1] + dLat];
}

export function ghPath(points: LngLat[], extra: Partial<GHPath> = {}): GHPath {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    points,
    distance: 1000,
    time: 60_000,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    instructions: [],
    snappedWaypoints: [points[0]!, points[points.length - 1]!],
    details: {},
    ...extra,
  };
}
