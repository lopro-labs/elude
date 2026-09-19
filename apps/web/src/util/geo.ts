import type { LngLat, RoutePath } from '@elude/shared';
import { lineString, point, nearestPointOnLine, distance, bearing } from '@turf/turf';

export interface SnapResult {
  /** snapped position on the route */
  lngLat: LngLat;
  /** distance from raw fix to route, metres */
  offRouteM: number;
  /** index of the segment start point in RoutePath.points */
  index: number;
  /** distance travelled along route to the snapped point, metres */
  alongM: number;
}

export function haversineM(a: LngLat, b: LngLat): number {
  return distance(point(a), point(b), { units: 'kilometers' }) * 1000;
}

export function bearingDeg(a: LngLat, b: LngLat): number {
  const brg = bearing(point(a), point(b));
  return (brg + 360) % 360;
}

/** Cumulative distance (m) at each point index. */
export function cumulativeDistances(points: LngLat[]): number[] {
  const out = new Array<number>(points.length);
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < points.length; i++) {
    acc += haversineM(points[i - 1], points[i]);
    out[i] = acc;
  }
  return out;
}

export function snapToRoute(pos: LngLat, path: RoutePath, cum?: number[]): SnapResult | null {
  if (path.points.length < 2) return null;
  const line = lineString(path.points);
  const snapped = nearestPointOnLine(line, point(pos), { units: 'kilometers' });
  const index = snapped.properties.index ?? 0;
  const lngLat = snapped.geometry.coordinates as LngLat;
  const dist = (snapped.properties.dist ?? 0) * 1000;
  const c = cum ?? cumulativeDistances(path.points);
  const alongM = c[index] + haversineM(path.points[index], lngLat);
  return { lngLat, offRouteM: dist, index, alongM };
}

/** Find the instruction whose interval contains the given point index. */
export function instructionIndexForPoint(path: RoutePath, pointIndex: number): number {
  const ins = path.instructions;
  for (let i = 0; i < ins.length; i++) {
    const [s, e] = ins[i].interval;
    if (pointIndex >= s && pointIndex < Math.max(e, s + 1)) return i;
  }
  return Math.max(0, ins.length - 1);
}

/** Point where an instruction's maneuver happens (start of its interval). */
export function maneuverPoint(path: RoutePath, insIndex: number): LngLat {
  const ins = path.instructions[insIndex];
  const idx = Math.min(ins.interval[0], path.points.length - 1);
  return path.points[idx];
}

export function bboxOfPoints(points: LngLat[]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of points) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Move `metres` along the path from cumulative distance `alongM`; returns new position + index + heading. */
export function pointAlong(points: LngLat[], cum: number[], alongM: number): { lngLat: LngLat; index: number; heading: number } {
  const total = cum[cum.length - 1];
  if (alongM >= total) {
    const n = points.length;
    return { lngLat: points[n - 1], index: n - 2, heading: bearingDeg(points[n - 2], points[n - 1]) };
  }
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < alongM) i++;
  const segLen = cum[i + 1] - cum[i] || 1;
  const t = Math.min(1, Math.max(0, (alongM - cum[i]) / segLen));
  const a = points[i], b = points[i + 1];
  const lngLat: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { lngLat, index: i, heading: bearingDeg(a, b) };
}
