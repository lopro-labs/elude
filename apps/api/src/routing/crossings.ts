import RBush from 'rbush';
import type { CameraFeature, CrossedCamera, LngLat } from '@elude/shared';
import type { GHPath, PathDetail } from './graphhopper.js';
import { metresToDegrees } from '../util/geo.js';
import { CORE_RADIUS_M } from './avoidGeometry.js';

interface SegItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  i: number;
}

const DEG = Math.PI / 180;

/**
 * Distance (metres) from point p to segment a-b using a local equirectangular
 * projection centred on p. Accurate to well under 1% for segments < ~50 km.
 * Returns the distance and the fraction t along the segment of the closest point.
 */
export function pointToSegmentM(p: LngLat, a: LngLat, b: LngLat): { dist: number; t: number } {
  const kx = 111_320 * Math.cos(p[1] * DEG);
  const ky = 111_320;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(cx, cy), t };
}

/**
 * Compass bearing (degrees [0,360), 0 = north, clockwise) from `from` to `to`,
 * using a local equirectangular approximation (fine at camera-buffer scales).
 */
export function bearingDeg(from: LngLat, to: LngLat): number {
  const dx = (to[0] - from[0]) * Math.cos(((from[1] + to[1]) / 2) * DEG);
  const dy = to[1] - from[1];
  const b = Math.atan2(dx, dy) / DEG;
  return ((b % 360) + 360) % 360;
}

/** Absolute angular difference between two compass bearings, degrees in [0,180]. */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function detailAt(details: PathDetail[] | undefined, index: number): string | number | null | undefined {
  if (!details) return undefined;
  for (const [from, to, value] of details) {
    if (index >= from && index <= to) return value;
  }
  return undefined;
}

export interface CrossingsResult {
  /** One entry per crossed camera, sorted by position along the route. */
  crossings: CrossedCamera[];
  /**
   * Cameras the path passed within `radiusM` of that did not count because
   * they face away from the closest-approach point (direction-aware mode).
   */
  avoidedByDirection: number;
}

/**
 * Find cameras within `radiusM` of the path line. `cameras` should already be
 * limited to the route's bbox (e.g. via CameraStore.query).
 *
 * When `directionAware` is true, a camera with a known facing only counts if
 * the closest-approach point lies in its front half-plane (bearing from camera
 * to that point within ±90° of `direction`) or the path comes within the
 * CORE_RADIUS_M core around the pole; passes behind such a camera are counted
 * in `avoidedByDirection` instead.
 */
export function analyseCrossings(
  path: Pick<GHPath, 'points' | 'details'>,
  cameras: CameraFeature[],
  radiusM: number,
  directionAware = true,
): CrossingsResult {
  const pts = path.points;
  if (pts.length < 2 || cameras.length === 0) return { crossings: [], avoidedByDirection: 0 };

  // Index path segments.
  const items: SegItem[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    items.push({
      minX: Math.min(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]),
      maxY: Math.max(a[1], b[1]),
      i,
    });
  }
  const tree = new RBush<SegItem>();
  tree.load(items);

  const roadEnv = path.details?.road_environment;
  const out: CrossedCamera[] = [];
  let avoidedByDirection = 0;
  for (const cam of cameras) {
    const c = cam.geometry.coordinates as LngLat;
    const { dLat, dLon } = metresToDegrees(radiusM, c[1]);
    const near = tree.search({ minX: c[0] - dLon, minY: c[1] - dLat, maxX: c[0] + dLon, maxY: c[1] + dLat });
    if (near.length === 0) continue;
    let best = Infinity;
    let bestIndex = -1;
    let bestPoint: LngLat = c;
    for (const seg of near) {
      const a = pts[seg.i]!;
      const b = pts[seg.i + 1]!;
      const { dist, t } = pointToSegmentM(c, a, b);
      if (dist < best) {
        best = dist;
        bestIndex = t < 0.5 ? seg.i : seg.i + 1;
        bestPoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      }
    }
    if (best > radiusM) continue;
    const direction = directionAware ? cam.properties.direction : undefined;
    if (direction !== undefined && best > CORE_RADIUS_M && bearingDiff(bearingDeg(c, bestPoint), direction) > 90) {
      avoidedByDirection++;
      continue;
    }
    const env = detailAt(roadEnv, bestIndex);
    const crossed: CrossedCamera = {
      id: cam.properties.id,
      lngLat: [c[0], c[1]],
      distanceM: Math.round(best * 10) / 10,
      pathIndex: bestIndex,
      possiblyNotVisible: env === 'bridge' || env === 'tunnel' || env === 'BRIDGE' || env === 'TUNNEL',
    };
    if (cam.properties.manufacturer) crossed.manufacturer = cam.properties.manufacturer;
    crossed.osmType = cam.properties.osmType;
    if (cam.properties.operator) crossed.operator = cam.properties.operator;
    if (cam.properties.direction !== undefined) crossed.direction = cam.properties.direction;
    out.push(crossed);
  }
  out.sort((a, b) => a.pathIndex - b.pathIndex);
  return { crossings: out, avoidedByDirection };
}

/** Back-compat wrapper around {@link analyseCrossings} returning just the crossings. */
export function findCrossings(
  path: Pick<GHPath, 'points' | 'details'>,
  cameras: CameraFeature[],
  radiusM: number,
  directionAware = true,
): CrossedCamera[] {
  return analyseCrossings(path, cameras, radiusM, directionAware).crossings;
}
