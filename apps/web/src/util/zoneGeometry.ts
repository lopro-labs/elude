import type { AvoidZone, LngLat } from '@elude/shared';
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import type { DrawState, StoredZone } from '../state/store';
import { haversineMeters } from '../state/store';

const DEG = Math.PI / 180;

/** Equirectangular circle ring (matches the backend's circle approximation closely enough for display). */
export function circleRing(center: LngLat, radiusM: number, steps = 48): LngLat[] {
  const [lon, lat] = center;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos(lat * DEG)));
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

function zonePolygon(zone: AvoidZone): Feature<Polygon> {
  const ring = zone.type === 'circle' ? circleRing(zone.center, zone.radiusM) : [...zone.points, zone.points[0]];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** FeatureCollection of all committed zones (each polygon carries its id for hit-testing). */
export function zonesFC(zones: StoredZone[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => {
      const f = zonePolygon(z.zone);
      f.properties = { id: z.id };
      return f;
    }),
  };
}

/** Human label for a zone (used in the panel list). */
export function zoneLabel(zone: AvoidZone): string {
  if (zone.type === 'circle') {
    const r = zone.radiusM;
    const txt = r >= 1000 ? `${(r / 1000).toFixed(r < 10_000 ? 1 : 0)} km` : `${Math.round(r / 10) * 10} m`;
    return `Circle · ${txt} radius`;
  }
  return `Area · ${zone.points.length} points`;
}

/** Rubber-band preview for the in-progress draw. */
export function draftFC(draw: DrawState): FeatureCollection<Polygon | LineString> {
  const empty: FeatureCollection<Polygon | LineString> = { type: 'FeatureCollection', features: [] };
  if (draw.mode === 'off') return empty;

  if (draw.mode === 'circle') {
    if (draw.points.length === 0 || !draw.cursor) return empty;
    const r = Math.max(1, haversineMeters(draw.points[0], draw.cursor));
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(draw.points[0], r)] } }] };
  }

  // polygon: closed fill once ≥3 points (incl. cursor), else a running line
  const pts = draw.cursor ? [...draw.points, draw.cursor] : draw.points;
  if (pts.length < 2) return empty;
  if (pts.length >= 3) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } }] };
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] };
}
