import type { BBox, LngLat } from '@elude/shared';

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/** Haversine distance in metres between two [lon, lat] points. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const la1 = a[1] * DEG;
  const la2 = b[1] * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Degrees of latitude / longitude that correspond to `metres` at latitude `lat`. */
export function metresToDegrees(metres: number, lat: number): { dLat: number; dLon: number } {
  const dLat = metres / 111_320;
  const cos = Math.max(0.05, Math.cos(lat * DEG));
  return { dLat, dLon: metres / (111_320 * cos) };
}

/** Expand a bbox by `metres` on every side. */
export function expandBboxM(bbox: BBox, metres: number): BBox {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const { dLat, dLon } = metresToDegrees(metres, midLat);
  return [
    Math.max(-180, bbox[0] - dLon),
    Math.max(-90, bbox[1] - dLat),
    Math.min(180, bbox[2] + dLon),
    Math.min(90, bbox[3] + dLat),
  ];
}

export function bboxOfPoints(points: LngLat[]): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/**
 * Bounding box for a route search: bbox of all stops (origin, waypoints,
 * destination) expanded by `max(fraction * size, minMetres) * scale` on each side.
 */
export function routeSearchBbox(
  stops: LngLat[],
  fraction = 0.2,
  minMetres = 15_000,
  scale = 1,
): BBox {
  const base = bboxOfPoints(stops);
  const midLat = (base[1] + base[3]) / 2;
  const widthM = haversineM([base[0], midLat], [base[2], midLat]);
  const heightM = haversineM([base[0], base[1]], [base[0], base[3]]);
  const padX = Math.max(widthM * fraction, minMetres) * scale;
  const padY = Math.max(heightM * fraction, minMetres) * scale;
  const { dLat } = metresToDegrees(padY, midLat);
  const { dLon } = metresToDegrees(padX, midLat);
  return [
    Math.max(-180, base[0] - dLon),
    Math.max(-90, base[1] - dLat),
    Math.min(180, base[2] + dLon),
    Math.min(90, base[3] + dLat),
  ];
}
