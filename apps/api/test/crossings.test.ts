import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import type { LngLat } from '@elude/shared';
import { analyseCrossings, bearingDeg, bearingDiff, findCrossings, pointToSegmentM } from '../src/routing/crossings.js';
import { camera, ghPath, offsetM } from './helpers.js';

const A: LngLat = [-122.42, 37.77];
const B: LngLat = offsetM(A, 2000, 0); // 2 km east
const C: LngLat = offsetM(B, 0, 2000); // then 2 km north
const line = ghPath([A, B, C]);

describe('pointToSegmentM', () => {
  it('matches turf distances', () => {
    const p = offsetM(A, 700, 40);
    const mine = pointToSegmentM(p, A, B).dist;
    const ref = turf.pointToLineDistance(turf.point(p), turf.lineString([A, B]), { units: 'meters' });
    expect(Math.abs(mine - ref)).toBeLessThan(0.5);
  });
});

describe('findCrossings', () => {
  it('detects a camera 10 m off the line and ignores one 100 m off', () => {
    const near = camera(offsetM(A, 1200, 10), 'Flock Safety', 1, 90);
    const far = camera(offsetM(A, 1500, 100), 'Flock Safety', 2);
    const res = findCrossings(line, [near, far], 30);
    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe(1);
    expect(res[0]!.distanceM).toBeGreaterThan(9);
    expect(res[0]!.distanceM).toBeLessThan(11);
    expect(res[0]!.manufacturer).toBe('Flock Safety');
    expect(res[0]!.pathIndex).toBe(1); // closer to B than to A
    expect(res[0]!.possiblyNotVisible).toBe(false);
    expect(res[0]!.operator).toBe('Test PD');
    expect(res[0]!.osmType).toBe('node');
    expect(res[0]!.direction).toBe(90);
  });

  it('respects the radius', () => {
    const far = camera(offsetM(A, 1500, 100), 'Flock Safety', 2);
    expect(findCrossings(line, [far], 150)).toHaveLength(1);
  });

  it('flags bridges/tunnels via road_environment details', () => {
    const cam = camera(offsetM(B, 5, 1000), 'Flock Safety', 3); // next to segment B-C
    const path = ghPath([A, B, C], {
      details: {
        road_environment: [
          [0, 1, 'road'],
          [1, 2, 'bridge'],
        ],
      },
    });
    const res = findCrossings(path, [cam], 30);
    expect(res).toHaveLength(1);
    expect(res[0]!.possiblyNotVisible).toBe(true);
  });

  it('sorts crossings by position along the route', () => {
    const c1 = camera(offsetM(A, 1800, 5), 'x', 10);
    const c2 = camera(offsetM(A, 200, 5), 'x', 11);
    const c3 = camera(offsetM(B, 5, 1500), 'x', 12);
    const res = findCrossings(line, [c1, c2, c3], 30).map((c) => c.id);
    expect(res).toEqual([11, 10, 12]);
  });
});

describe('bearing helpers', () => {
  it('bearingDeg follows compass convention (0 = north, clockwise)', () => {
    expect(bearingDeg(A, offsetM(A, 0, 100))).toBeCloseTo(0, 1);
    expect(bearingDeg(A, offsetM(A, 100, 0))).toBeCloseTo(90, 1);
    expect(bearingDeg(A, offsetM(A, 0, -100))).toBeCloseTo(180, 1);
    expect(bearingDeg(A, offsetM(A, -100, 0))).toBeCloseTo(270, 1);
  });

  it('bearingDiff wraps around', () => {
    expect(bearingDiff(350, 10)).toBe(20);
    expect(bearingDiff(0, 180)).toBe(180);
    expect(bearingDiff(90, 90)).toBe(0);
  });
});

describe('directional crossings', () => {
  // The A->B leg runs west to east; a camera 20 m north of it.
  const northOfLine = offsetM(A, 1000, 20);

  it('a pass in front counts as a crossing', () => {
    const facingPath = camera(northOfLine, 'Flock Safety', 20, 180); // faces south, toward the path
    const res = analyseCrossings(line, [facingPath], 30, true);
    expect(res.crossings).toHaveLength(1);
    expect(res.crossings[0]!.id).toBe(20);
    expect(res.avoidedByDirection).toBe(0);
  });

  it('a pass behind is not a crossing but is counted in avoidedByDirection', () => {
    const facingAway = camera(northOfLine, 'Flock Safety', 21, 0); // faces north, away from the path
    const res = analyseCrossings(line, [facingAway], 30, true);
    expect(res.crossings).toHaveLength(0);
    expect(res.avoidedByDirection).toBe(1);
  });

  it('directionAware=false treats a facing-away camera as a crossing', () => {
    const facingAway = camera(northOfLine, 'Flock Safety', 22, 0);
    const res = analyseCrossings(line, [facingAway], 30, false);
    expect(res.crossings).toHaveLength(1);
    expect(res.avoidedByDirection).toBe(0);
  });

  it('a pass within the 10 m core counts even behind the camera', () => {
    const facingAway = camera(offsetM(A, 1000, 8), 'Flock Safety', 23, 0); // 8 m north, faces away
    const res = analyseCrossings(line, [facingAway], 30, true);
    expect(res.crossings).toHaveLength(1);
    expect(res.avoidedByDirection).toBe(0);
  });

  it('omni cameras behave as before', () => {
    const omni = camera(northOfLine, 'Flock Safety', 24);
    const res = analyseCrossings(line, [omni], 30, true);
    expect(res.crossings).toHaveLength(1);
    expect(res.avoidedByDirection).toBe(0);
  });

  it('a camera outside the buffer is neither a crossing nor avoidedByDirection', () => {
    const far = camera(offsetM(A, 1000, 100), 'Flock Safety', 25, 0);
    const res = analyseCrossings(line, [far], 30, true);
    expect(res.crossings).toHaveLength(0);
    expect(res.avoidedByDirection).toBe(0);
  });
});
