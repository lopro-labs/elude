import type { LngLat } from '@elude/shared';
import type { Feature, FeatureCollection, Polygon } from 'geojson';

/** Half-angle (deg) of the wide zone Elude treats as watched — matches the API's ±90° avoid half-disc. */
export const AVOID_HALF_DEG = 90;
/** Half-angle (deg) of the brighter "likely line of sight" cone. */
export const VIEW_HALF_DEG = 28;

/** Destination point `distM` metres from [lng,lat] along compass `bearingDeg` (0 = N, clockwise). */
function destination([lng, lat]: LngLat, bearingDeg: number, distM: number): LngLat {
  const R = 6_371_000;
  const d = distM / R;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

/** Pie-slice polygon from `fromDeg` to `toDeg` (compass) at radius `rM`. A full 360° slice omits the apex. */
function sector(center: LngLat, rM: number, fromDeg: number, toDeg: number): Feature<Polygon> {
  const span = toDeg - fromDeg;
  const full = Math.abs(span) >= 359.9;
  const steps = Math.max(8, Math.ceil(Math.abs(span) / 8));
  const ring: LngLat[] = [];
  if (!full) ring.push(center);
  for (let i = 0; i <= steps; i++) ring.push(destination(center, fromDeg + (span * i) / steps, rM));
  if (!full) ring.push(center);
  else ring.push(ring[0]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Overlay geometry for a camera's coverage:
 *  - `avoid`: the ±90° half-disc Elude routes around (or a full ring if the
 *    camera has no tagged facing — treated as omnidirectional),
 *  - `view`: a narrower cone in the facing direction (only when directional),
 *    approximating the likely line of sight.
 */
export function cameraScopeFC(center: LngLat, direction: number | undefined, rM: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  if (direction == null || Number.isNaN(direction)) {
    const ring = sector(center, rM, 0, 360);
    ring.properties = { kind: 'avoid', omni: true };
    features.push(ring);
  } else {
    const dir = ((direction % 360) + 360) % 360;
    const avoid = sector(center, rM, dir - AVOID_HALF_DEG, dir + AVOID_HALF_DEG);
    avoid.properties = { kind: 'avoid', omni: false };
    const view = sector(center, rM, dir - VIEW_HALF_DEG, dir + VIEW_HALF_DEG);
    view.properties = { kind: 'view' };
    features.push(avoid, view);
  }
  return { type: 'FeatureCollection', features };
}
