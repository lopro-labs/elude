import { beforeEach, describe, expect, it } from 'vitest';
import type { BBox, CameraFeature, SurveillanceCategory } from '@elude/shared';
import { clearSurveillanceCache, getSurveillance } from '../src/cameras/surveillance.js';
import { camera, offsetM } from './helpers.js';

const P0: [number, number] = [-98.5, 39.5]; // arbitrary interior point; all assertions are relative
const BBOX: BBox = [-122.5, 37.7, -122.3, 37.9];

const alprCam = camera(P0, 'Flock Safety', 1);
const speedCam = (() => {
  const c = camera(offsetM(P0, 100, 0), 'n/a', 2);
  c.properties.category = 'speed';
  return c;
})();

const store = { query: () => [alprCam] };

beforeEach(() => clearSurveillanceCache());

describe('getSurveillance', () => {
  it('reads ALPR from the store without fetching', async () => {
    let fetched = 0;
    const out = await getSurveillance(BBOX, ['alpr'], () => {}, {
      store,
      fetcher: async () => {
        fetched++;
        return [];
      },
    });
    expect(out).toEqual([alprCam]);
    expect(fetched).toBe(0);
  });

  it('fetches non-ALPR categories and caches within the TTL', async () => {
    let fetched = 0;
    const fetcher = async () => {
      fetched++;
      return [speedCam];
    };
    let t = 1000;
    const opts = { store, fetcher, ttlMs: 10_000, now: () => t };
    const a = await getSurveillance(BBOX, ['speed'], () => {}, opts);
    expect(a).toEqual([speedCam]);
    expect(fetched).toBe(1);
    // within TTL -> cache hit, no refetch
    t = 5000;
    await getSurveillance(BBOX, ['speed'], () => {}, opts);
    expect(fetched).toBe(1);
    // past TTL -> refetch
    t = 20_000;
    await getSurveillance(BBOX, ['speed'], () => {}, opts);
    expect(fetched).toBe(2);
  });

  it('combines ALPR (store) with extra categories (fetch)', async () => {
    const requested: SurveillanceCategory[][] = [];
    const out = await getSurveillance(BBOX, ['alpr', 'speed'], () => {}, {
      store,
      fetcher: async (_b, cats) => {
        requested.push(cats);
        return [speedCam];
      },
    });
    expect(out).toHaveLength(2);
    expect(out).toContain(alprCam);
    expect(out).toContain(speedCam);
    // only non-alpr categories are passed to the fetcher
    expect(requested).toEqual([['speed']]);
  });

  it('caps returned features and logs when truncated', async () => {
    const many: CameraFeature[] = Array.from({ length: 5 }, (_, i) => camera(offsetM(P0, i, 0), 'x', 100 + i));
    const logs: string[] = [];
    const out = await getSurveillance(BBOX, ['cctv'], (m) => logs.push(m), {
      store,
      fetcher: async () => many,
      maxFeatures: 3,
    });
    expect(out).toHaveLength(3);
    expect(logs.some((l) => l.includes('truncat'))).toBe(true);
  });
});
