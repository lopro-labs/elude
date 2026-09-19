import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import RBush from 'rbush';
import type { BBox, CameraCollection, CameraFeature, CameraStats } from '@elude/shared';
import { config } from '../config.js';
import { fetchCameras } from './overpass.js';

interface Item {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  feature: CameraFeature;
}

interface CachedCollection extends CameraCollection {
  fetchedAt?: string;
  source?: CameraStats['source'];
}

export interface CameraStoreOptions {
  dataDir?: string;
  fallbackPath?: string;
  regionBbox?: BBox;
  refreshHours?: number;
  fetcher?: (bbox: BBox, log: (m: string) => void) => Promise<CameraFeature[]>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export class CameraStore {
  private tree = new RBush<Item>();
  private features: CameraFeature[] = [];
  private fetchedAt: string | null = null;
  private source: CameraStats['source'] = 'fallback';
  private manufacturers: Record<string, number> = {};
  private refreshing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly cachePath: string;
  private readonly fallbackPath: string;
  private readonly regionBbox: BBox;
  private readonly refreshMs: number;
  private readonly fetcher: NonNullable<CameraStoreOptions['fetcher']>;
  private log: (msg: string) => void;
  private warn: (msg: string) => void;
  /** Resolves once the store has *some* data (cache, fallback, or fresh). */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(opts: CameraStoreOptions = {}) {
    const dataDir = opts.dataDir ?? config.dataDir;
    this.cachePath = path.join(dataDir, 'cameras.geojson');
    this.fallbackPath = opts.fallbackPath ?? path.join(config.packageDir, 'data', 'cameras.fallback.geojson');
    this.regionBbox = opts.regionBbox ?? config.regionBbox;
    this.refreshMs = Math.max(0.05, opts.refreshHours ?? config.cameraRefreshHours) * 3_600_000;
    this.fetcher = opts.fetcher ?? ((bbox, log) => fetchCameras(bbox, { log }));
    this.log = opts.log ?? ((m) => console.log(m));
    this.warn = opts.warn ?? ((m) => console.warn(m));
    this.ready = new Promise<void>((r) => (this.resolveReady = r));
  }

  /** Route store log output through the app logger. */
  setLogger(log: (msg: string) => void, warn: (msg: string) => void): void {
    this.log = log;
    this.warn = warn;
  }

  /** Replace the in-memory data set. */
  setFeatures(features: CameraFeature[], source: CameraStats['source'], fetchedAt: string | null): void {
    const items: Item[] = [];
    const manufacturers: Record<string, number> = {};
    for (const f of features) {
      const [x, y] = f.geometry.coordinates;
      items.push({ minX: x, minY: y, maxX: x, maxY: y, feature: f });
      const m = f.properties.manufacturer?.trim() || 'unknown';
      manufacturers[m] = (manufacturers[m] ?? 0) + 1;
    }
    const tree = new RBush<Item>();
    tree.load(items);
    this.tree = tree;
    this.features = features;
    this.manufacturers = manufacturers;
    this.source = source;
    this.fetchedAt = fetchedAt;
    this.resolveReady();
  }

  get size(): number {
    return this.features.length;
  }

  all(): CameraFeature[] {
    return this.features;
  }

  /** Cameras inside bbox [w,s,e,n], optionally filtered by manufacturer substring (case-insensitive). */
  query(bbox: BBox, manufacturer?: string): CameraFeature[] {
    const hits = this.tree.search({ minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3] });
    const needle = manufacturer?.trim().toLowerCase();
    const out: CameraFeature[] = [];
    for (const h of hits) {
      if (needle) {
        const m = h.feature.properties.manufacturer?.toLowerCase() ?? '';
        if (!m.includes(needle)) continue;
      }
      out.push(h.feature);
    }
    return out;
  }

  stats(): CameraStats {
    return {
      count: this.features.length,
      fetchedAt: this.fetchedAt,
      source: this.source,
      manufacturers: { ...this.manufacturers },
    };
  }

  private isStale(fetchedAt: string | null): boolean {
    if (!fetchedAt) return true;
    const t = Date.parse(fetchedAt);
    return !Number.isFinite(t) || Date.now() - t > this.refreshMs;
  }

  private async loadFile(p: string): Promise<CachedCollection | null> {
    try {
      if (!fs.existsSync(p)) return null;
      const raw = await fsp.readFile(p, 'utf8');
      const json = JSON.parse(raw) as CachedCollection;
      if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) return null;
      return json;
    } catch (err) {
      this.warn(`cameras: failed to read ${p}: ${(err as Error).message}`);
      return null;
    }
  }

  private async saveCache(features: CameraFeature[], fetchedAt: string): Promise<void> {
    try {
      await fsp.mkdir(path.dirname(this.cachePath), { recursive: true });
      const body: CachedCollection = { type: 'FeatureCollection', fetchedAt, source: 'overpass', features };
      const tmp = this.cachePath + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(body));
      await fsp.rename(tmp, this.cachePath);
    } catch (err) {
      this.warn(`cameras: failed to write cache ${this.cachePath}: ${(err as Error).message}`);
    }
  }

  /** Fetch from Overpass; on success swap data + write cache. Serves stale data on failure. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const t0 = Date.now();
      try {
        this.log(`cameras: fetching from Overpass for bbox [${this.regionBbox.join(', ')}]`);
        const features = await this.fetcher(this.regionBbox, this.log);
        const fetchedAt = new Date().toISOString();
        this.setFeatures(features, 'overpass', fetchedAt);
        this.log(`cameras: loaded ${features.length} cameras from Overpass in ${Date.now() - t0} ms`);
        await this.saveCache(features, fetchedAt);
      } catch (err) {
        this.warn(`cameras: Overpass refresh failed (${(err as Error).message}); serving ${this.features.length} cached cameras`);
        if (this.features.length === 0) await this.loadFallback();
        throw err;
      } finally {
        this.refreshing = null;
      }
    })();
    // Avoid unhandled rejections for fire-and-forget callers; awaiting callers still get the error.
    this.refreshing.catch(() => {});
    return this.refreshing;
  }

  private async loadFallback(): Promise<boolean> {
    const fb = await this.loadFile(this.fallbackPath);
    if (!fb) {
      this.warn(`cameras: no fallback snapshot at ${this.fallbackPath}`);
      this.setFeatures([], 'fallback', null);
      return false;
    }
    this.setFeatures(fb.features, 'fallback', fb.fetchedAt ?? null);
    this.log(`cameras: loaded ${fb.features.length} cameras from fallback snapshot`);
    return true;
  }

  /**
   * Start the store: load disk cache, refresh from Overpass if missing/stale (in the
   * background), fall back to the bundled snapshot when nothing else is available.
   * Never throws; resolves as soon as some data is available.
   */
  async start(): Promise<void> {
    const cached = await this.loadFile(this.cachePath);
    if (cached) {
      this.setFeatures(cached.features, 'cache', cached.fetchedAt ?? null);
      this.log(`cameras: loaded ${cached.features.length} cameras from cache (${cached.fetchedAt ?? 'unknown date'})`);
    }
    if (!cached || this.isStale(cached.fetchedAt ?? null)) {
      if (!cached) {
        // Nothing to serve yet: load the fallback immediately so requests work while Overpass runs.
        await this.loadFallback();
      }
      void this.refresh().catch(() => {});
    }
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.refresh().catch(() => {});
    }, this.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Process-wide store instance used by the HTTP routes and the planner. */
export const cameraStore = new CameraStore();
