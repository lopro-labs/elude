import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import type { AvoidZone, LngLat } from '@elude/shared';
import { buildAvoidArea, buildZonesArea, camerasContainingPoint, circlePolygon } from '../src/routing/avoidGeometry.js';
import { camera, offsetM } from './helpers.js';

const P0: [number, number] = [-98.5, 39.5]; // arbitrary interior point; all assertions are relative

describe('buildAvoidArea', () => {
  it('returns null for no cameras', () => {
    expect(buildAvoidArea([], 30)).toBeNull();
  });

  it('produces a Feature with id "cams" and valid polygon geometry', () => {
    const cams = [camera(P0), camera(offsetM(P0, 500, 0)), camera(offsetM(P0, 0, 500))];
    const area = buildAvoidArea(cams, 30)!;
    expect(area).not.toBeNull();
    expect(area.type).toBe('Feature');
    expect(area.id).toBe('cams');
    expect(area.geometry.type).toBe('MultiPolygon');
    if (area.geometry.type !== 'MultiPolygon') throw new Error('unreachable');
    expect(area.geometry.coordinates).toHaveLength(3);
    for (const poly of area.geometry.coordinates) {
      const ring = poly[0]!;
      // closed ring, 12-gon
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.length).toBe(13);
      // roughly the right size
      const areaM2 = turf.area(turf.polygon(poly));
      expect(areaM2).toBeGreaterThan(Math.PI * 30 * 30 * 0.8);
      expect(areaM2).toBeLessThan(Math.PI * 30 * 30 * 1.05);
    }
    // each camera lies inside its own polygon
    for (const c of cams) {
      expect(turf.booleanPointInPolygon(c.geometry.coordinates, area.geometry)).toBe(true);
    }
  });

  it('merges overlapping circles into fewer polygons', () => {
    const cams = [camera(P0), camera(offsetM(P0, 20, 0)), camera(offsetM(P0, 40, 0)), camera(offsetM(P0, 2000, 0))];
    const area = buildAvoidArea(cams, 30)!;
    expect(area.geometry.type).toBe('MultiPolygon');
    if (area.geometry.type !== 'MultiPolygon') throw new Error('unreachable');
    expect(area.geometry.coordinates).toHaveLength(2);
    // merged polygon has more vertices than a single 12-gon
    const big = area.geometry.coordinates.find((p) => p[0]!.length > 13);
    expect(big).toBeDefined();
  });

  it('collapses to a single Polygon when everything merges', () => {
    const cams = [camera(P0), camera(offsetM(P0, 10, 10))];
    const area = buildAvoidArea(cams, 30)!;
    expect(area.geometry.type).toBe('Polygon');
  });

  it('circlePolygon has the requested radius', () => {
    const ring = circlePolygon(P0, 100);
    for (const p of ring) {
      const d = turf.distance(P0, p as [number, number], { units: 'meters' });
      expect(d).toBeGreaterThan(98);
      expect(d).toBeLessThan(102);
    }
  });
});

describe('directional avoid geometry', () => {
  // camera at P0 facing east (90 deg)
  const facingEast = camera(P0, 'Flock Safety', 500, 90);

  it('half-disc + core: in front inside, behind outside, pole core inside', () => {
    const area = buildAvoidArea([facingEast], 50)!;
    expect(area.geometry.type).toBe('Polygon'); // half-disc and core merge into one
    const front = offsetM(P0, 30, 0); // 30 m east, in front
    const behind = offsetM(P0, -30, 0); // 30 m west, behind
    const nearPole = offsetM(P0, -5, 0); // 5 m behind, but inside the 10 m core
    expect(turf.booleanPointInPolygon(front, area.geometry)).toBe(true);
    expect(turf.booleanPointInPolygon(behind, area.geometry)).toBe(false);
    expect(turf.booleanPointInPolygon(nearPole, area.geometry)).toBe(true);
    expect(turf.booleanPointInPolygon(P0, area.geometry)).toBe(true);
  });

  it('directionAware=false keeps the full circle', () => {
    const area = buildAvoidArea([facingEast], 50, false)!;
    expect(turf.booleanPointInPolygon(offsetM(P0, -30, 0), area.geometry)).toBe(true);
  });

  it('cameras without a direction keep the full circle', () => {
    const omni = camera(P0, 'Flock Safety', 501);
    const area = buildAvoidArea([omni], 50)!;
    expect(turf.booleanPointInPolygon(offsetM(P0, -30, 0), area.geometry)).toBe(true);
    expect(turf.booleanPointInPolygon(offsetM(P0, 30, 0), area.geometry)).toBe(true);
  });

  it('directional and omni cameras still merge through the union pipeline', () => {
    const cams = [facingEast, camera(offsetM(P0, 30, 0), 'Flock Safety', 502)];
    const area = buildAvoidArea(cams, 50)!;
    expect(area.geometry.type).toBe('Polygon');
    // behind the directional camera but inside the omni circle of the second one
    expect(turf.booleanPointInPolygon(offsetM(P0, 60, 0), area.geometry)).toBe(true);
  });
});

describe('buildZonesArea', () => {
  it('returns null for an empty list', () => {
    expect(buildZonesArea([])).toBeNull();
  });

  it('uses the zones id and covers a point inside a drawn circle, excludes outside', () => {
    const zones: AvoidZone[] = [{ type: 'circle', center: P0, radiusM: 100 }];
    const area = buildZonesArea(zones)!;
    expect(area).not.toBeNull();
    expect(area.id).toBe('zones');
    const inside = offsetM(P0, 50, 0); // 50 m east, within 100 m
    const outside = offsetM(P0, 300, 0); // 300 m east, well outside
    expect(turf.booleanPointInPolygon(inside, area.geometry)).toBe(true);
    expect(turf.booleanPointInPolygon(outside, area.geometry)).toBe(false);
  });

  it('closes a polygon ring and contains interior points', () => {
    // ~200 m square around P0 (open ring – not repeating the first point)
    const ring: LngLat[] = [
      offsetM(P0, -100, -100),
      offsetM(P0, 100, -100),
      offsetM(P0, 100, 100),
      offsetM(P0, -100, 100),
    ];
    const area = buildZonesArea([{ type: 'polygon', points: ring }])!;
    expect(area.id).toBe('zones');
    expect(turf.booleanPointInPolygon(P0, area.geometry)).toBe(true);
    expect(turf.booleanPointInPolygon(offsetM(P0, 500, 0), area.geometry)).toBe(false);
  });

  it('unions multiple zones into one feature', () => {
    const zones: AvoidZone[] = [
      { type: 'circle', center: P0, radiusM: 80 },
      { type: 'circle', center: offsetM(P0, 5000, 0), radiusM: 80 },
    ];
    const area = buildZonesArea(zones)!;
    expect(area.geometry.type).toBe('MultiPolygon');
    expect(turf.booleanPointInPolygon(P0, area.geometry)).toBe(true);
    expect(turf.booleanPointInPolygon(offsetM(P0, 5000, 0), area.geometry)).toBe(true);
  });

  it('skips degenerate zones (radius 0, <3 points)', () => {
    expect(buildZonesArea([{ type: 'circle', center: P0, radiusM: 0 }])).toBeNull();
    expect(buildZonesArea([{ type: 'polygon', points: [P0, offsetM(P0, 10, 0)] }])).toBeNull();
  });
});

describe('camerasContainingPoint', () => {
  it('finds cameras within radius', () => {
    const near = camera(offsetM(P0, 20, 0));
    const far = camera(offsetM(P0, 60, 0));
    expect(camerasContainingPoint([near, far], P0, 30)).toEqual([near]);
    expect(camerasContainingPoint([near, far], P0, 100)).toHaveLength(2);
  });
});
