import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import polygonClipping from 'polygon-clipping';
import type { AvoidZone, CameraFeature, LngLat } from '@elude/shared';
import RBush from 'rbush';
import { haversineM, metresToDegrees } from '../util/geo.js';

export const AVOID_AREA_ID = 'cams';
/** Feature id for the user-drawn avoid zones area. */
export const ZONES_AREA_ID = 'zones';
/** Circle approximation steps for user-drawn circular zones (finer than cameras). */
const ZONE_CIRCLE_STEPS = 24;
const CIRCLE_STEPS = 12;
const DEG = Math.PI / 180;
/** Always-blocked core radius around a directional camera's pole, metres. */
export const CORE_RADIUS_M = 10;
/** Points approximating the 180° arc of a directional camera's front half-disc. */
const HALF_DISC_ARC_POINTS = 13;

/**
 * Approximate circle (12-gon) around [lon, lat] with radius in metres.
 * Uses a local equirectangular approximation, which is more than accurate
 * enough for radii of a few hundred metres.
 */
export function circlePolygon(center: LngLat, radiusM: number, steps = CIRCLE_STEPS): Position[] {
  const [lon, lat] = center;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos(lat * DEG)));
  const ring: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([
      round(lon + dLon * Math.cos(a)),
      round(lat + dLat * Math.sin(a)),
    ]);
  }
  ring.push(ring[0]!);
  return ring;
}

function round(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

/**
 * Half-disc covering the front of a directional camera: a fan from the pole
 * across compass bearings `directionDeg ± 90°` at `radiusM` (0 = north,
 * clockwise). The arc is approximated with `arcPoints` points, mirroring the
 * 12-gon circle style; sweep runs from `direction + 90°` down to
 * `direction - 90°` so the ring is counter-clockwise.
 */
export function halfDiscPolygon(
  center: LngLat,
  directionDeg: number,
  radiusM: number,
  arcPoints = HALF_DISC_ARC_POINTS,
): Position[] {
  const [lon, lat] = center;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos(lat * DEG)));
  const ring: Position[] = [[round(lon), round(lat)]];
  for (let i = 0; i < arcPoints; i++) {
    const bearing = (directionDeg + 90 - (180 * i) / (arcPoints - 1)) * DEG;
    ring.push([
      round(lon + dLon * Math.sin(bearing)),
      round(lat + dLat * Math.cos(bearing)),
    ]);
  }
  ring.push(ring[0]!);
  return ring;
}

export type AvoidFeature = Feature<MultiPolygon | Polygon>;

/**
 * Avoid polygon(s) for one camera. Omnidirectional (no direction tag, or
 * direction awareness off): one circumscribed 12-gon. Directional: the front
 * half-disc plus a small full circle around the pole itself, to be unioned.
 * Radii are circumscribed so the true shape at `radiusM` is fully covered.
 */
function cameraPolygons(
  cam: CameraFeature,
  radiusM: number,
  directionAware: boolean,
): polygonClipping.Polygon[] {
  const center = cam.geometry.coordinates as LngLat;
  const direction = directionAware ? cam.properties.direction : undefined;
  const circumCircleR = radiusM / Math.cos(Math.PI / CIRCLE_STEPS);
  if (direction === undefined) {
    return [[circlePolygon(center, circumCircleR)] as polygonClipping.Polygon];
  }
  const circumArcR = radiusM / Math.cos(Math.PI / (2 * (HALF_DISC_ARC_POINTS - 1)));
  return [
    [halfDiscPolygon(center, direction, circumArcR)] as polygonClipping.Polygon,
    [circlePolygon(center, CORE_RADIUS_M / Math.cos(Math.PI / CIRCLE_STEPS))] as polygonClipping.Polygon,
  ];
}

/**
 * Build the GraphHopper "areas" feature: circles of `radiusM` around every
 * camera, unioned into a MultiPolygon (Polygon when everything merges into one).
 * The 12-gons are circumscribed (radius / cos(pi/12)) so that the whole
 * `radiusM` disc is covered. Returns null when there are no cameras.
 */
export function buildAvoidArea(
  cameras: CameraFeature[],
  radiusM: number,
  directionAware = true,
): AvoidFeature | null {
  if (cameras.length === 0) return null;
  const r = radiusM / Math.cos(Math.PI / CIRCLE_STEPS);
  const centers = cameras.map((c) => c.geometry.coordinates as LngLat);
  const polygons: Position[][][] = [];
  for (const cluster of clusterByDistance(centers, 2 * r)) {
    const polys = cluster.flatMap((i) => cameraPolygons(cameras[i]!, radiusM, directionAware));
    if (polys.length === 1) {
      polygons.push(polys[0] as unknown as Position[][]);
      continue;
    }
    const merged = polygonClipping.union(polys[0]!, ...polys.slice(1)) as Position[][][];
    for (const poly of merged) polygons.push(poly);
  }
  if (polygons.length === 0) return null;
  const geometry: MultiPolygon | Polygon =
    polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0]! }
      : { type: 'MultiPolygon', coordinates: polygons };
  return { type: 'Feature', id: AVOID_AREA_ID, properties: {}, geometry };
}

/**
 * Build the GraphHopper "areas" feature for user-drawn avoid zones. Each circle
 * becomes a `ZONE_CIRCLE_STEPS`-gon at its radius; each polygon becomes its
 * closed ring. All zones are unioned into one MultiPolygon (Polygon when they
 * merge into one). Returns null for an empty list. Feature id = ZONES_AREA_ID.
 */
export function buildZonesArea(zones: AvoidZone[]): AvoidFeature | null {
  if (zones.length === 0) return null;
  const polys: polygonClipping.Polygon[] = [];
  for (const zone of zones) {
    if (zone.type === 'circle') {
      if (!(zone.radiusM > 0)) continue;
      polys.push([circlePolygon(zone.center, zone.radiusM, ZONE_CIRCLE_STEPS)] as polygonClipping.Polygon);
    } else {
      if (zone.points.length < 3) continue;
      const ring: Position[] = zone.points.map((p) => [round(p[0]), round(p[1])]);
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0]!, first[1]!]);
      polys.push([ring] as polygonClipping.Polygon);
    }
  }
  if (polys.length === 0) return null;
  const merged =
    polys.length === 1
      ? (polys as unknown as Position[][][])
      : (polygonClipping.union(polys[0]!, ...polys.slice(1)) as Position[][][]);
  if (merged.length === 0) return null;
  const geometry: MultiPolygon | Polygon =
    merged.length === 1
      ? { type: 'Polygon', coordinates: merged[0]! }
      : { type: 'MultiPolygon', coordinates: merged };
  return { type: 'Feature', id: ZONES_AREA_ID, properties: {}, geometry };
}

/**
 * Group point indices into connected components where points closer than
 * `maxDistM` are linked (i.e. their circles overlap). Uses an rbush index so
 * that only genuinely overlapping circles are handed to polygon-clipping –
 * the vast majority of cameras are isolated and need no boolean ops at all.
 */
export function clusterByDistance(points: LngLat[], maxDistM: number): number[][] {
  interface Item { minX: number; minY: number; maxX: number; maxY: number; i: number }
  const tree = new RBush<Item>();
  tree.load(
    points.map((p, i) => ({ minX: p[0], minY: p[1], maxX: p[0], maxY: p[1], i })),
  );
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const { dLat, dLon } = metresToDegrees(maxDistM, p[1]);
    for (const hit of tree.search({ minX: p[0] - dLon, minY: p[1] - dLat, maxX: p[0] + dLon, maxY: p[1] + dLat })) {
      if (hit.i > i && haversineM(p, points[hit.i]!) < maxDistM) union(i, hit.i);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

/** Cameras within `radiusM` (metres) of `point`. */
export function camerasContainingPoint(cameras: CameraFeature[], point: LngLat, radiusM: number): CameraFeature[] {
  return cameras.filter((c) => haversineM(c.geometry.coordinates as LngLat, point) <= radiusM);
}
