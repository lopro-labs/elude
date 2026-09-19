import { describe, expect, it } from 'vitest';
import { routeRequestSchema } from '../src/routes/route.js';

const O = [-122.42, 37.77];
const D = [-122.3, 37.8];
const wp = (n: number) => Array.from({ length: n }, (_, i) => [-122.4 + i * 0.01, 37.78]);

describe('routeRequestSchema', () => {
  it('accepts a request without the new fields (backward compatible)', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D }).success).toBe(true);
  });

  it('accepts 0-8 waypoints', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: [] }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: wp(1) }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: wp(8) }).success).toBe(true);
  });

  it('rejects 9 waypoints', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: wp(9) }).success).toBe(false);
  });

  it('rejects bad waypoint coordinates', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: [[200, 37.8]] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: [[-122.4, 95]] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: [[-122.4]] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, waypoints: ['x'] }).success).toBe(false);
  });

  it('accepts directionAware as a boolean only', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, directionAware: false }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, directionAware: true }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, directionAware: 'yes' }).success).toBe(false);
  });

  const circle = (radiusM: number) => ({ type: 'circle', center: O, radiusM });
  const polygon = (n: number) => ({ type: 'polygon', points: Array.from({ length: n }, (_, i) => [-122.4 + i * 0.001, 37.78]) });

  it('accepts avoidZones circles within radius bounds', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [circle(1)] }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [circle(50_000)] }).success).toBe(true);
  });

  it('rejects avoidZones circles outside radius bounds', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [circle(0)] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [circle(50_001)] }).success).toBe(false);
  });

  it('requires polygon zones to have at least 3 points (max 200)', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [polygon(2)] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [polygon(3)] }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [polygon(200)] }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [polygon(201)] }).success).toBe(false);
  });

  it('rejects an unknown zone type', () => {
    expect(
      routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: [{ type: 'blob', center: O, radiusM: 5 }] }).success,
    ).toBe(false);
  });

  it('rejects more than 20 avoidZones', () => {
    const zones = Array.from({ length: 21 }, () => circle(10));
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: zones }).success).toBe(false);
    const twenty = Array.from({ length: 20 }, () => circle(10));
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidZones: twenty }).success).toBe(true);
  });

  it('accepts valid avoidCategories and rejects junk', () => {
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidCategories: ['alpr'] }).success).toBe(true);
    expect(
      routeRequestSchema.safeParse({ origin: O, destination: D, avoidCategories: ['alpr', 'speed', 'redlight', 'cctv'] }).success,
    ).toBe(true);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidCategories: ['bogus'] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ origin: O, destination: D, avoidCategories: 'alpr' }).success).toBe(false);
  });
});
