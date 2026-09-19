import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraStore } from '../src/cameras/store.js';
import { camera } from './helpers.js';

const dirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'elude-store-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const noop = () => {};

describe('CameraStore', () => {
  it('loads the fallback snapshot when Overpass fails and there is no cache', async () => {
    const dir = tmpDir();
    const fallback = path.join(dir, 'fallback.geojson');
    fs.writeFileSync(
      fallback,
      JSON.stringify({ type: 'FeatureCollection', fetchedAt: '2026-01-01T00:00:00Z', features: [camera([-122, 37], 'Flock Safety', 1)] }),
    );
    const store = new CameraStore({
      dataDir: dir,
      fallbackPath: fallback,
      fetcher: async () => {
        throw new Error('overpass down');
      },
      log: noop,
      warn: noop,
    });
    await store.start();
    await store.refresh().catch(() => {});
    expect(store.stats().source).toBe('fallback');
    expect(store.stats().count).toBe(1);
    expect(store.query([-123, 36, -121, 38])).toHaveLength(1);
    expect(store.query([-123, 36, -121, 38], 'motorola')).toHaveLength(0);
    store.stop();
  });

  it('fetches from Overpass, writes the cache, and reloads from cache', async () => {
    const dir = tmpDir();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return [camera([-122, 37], 'Flock Safety', 1), camera([-121, 36], 'Motorola Solutions', 2)];
    };
    const store = new CameraStore({ dataDir: dir, fallbackPath: path.join(dir, 'missing.geojson'), fetcher, log: noop, warn: noop });
    await store.start();
    await store.refresh();
    expect(calls).toBe(1);
    expect(store.stats().source).toBe('overpass');
    expect(store.stats().count).toBe(2);
    expect(store.stats().manufacturers['Flock Safety']).toBe(1);
    expect(fs.existsSync(path.join(dir, 'cameras.geojson'))).toBe(true);
    store.stop();

    // A fresh store finds a fresh cache and does not need to refetch.
    const store2 = new CameraStore({ dataDir: dir, fallbackPath: path.join(dir, 'missing.geojson'), fetcher, log: noop, warn: noop });
    await store2.start();
    expect(store2.stats().source).toBe('cache');
    expect(store2.stats().count).toBe(2);
    expect(calls).toBe(1);
    store2.stop();
  });
});
