import type { BBox, CameraFeature, SurveillanceCategory } from '@elude/shared';
import { cameraStore, type CameraStore } from './store.js';
import { fetchSurveillance } from './overpass.js';

/** Default cache lifetime for per-bbox non-ALPR surveillance fetches. */
export const SURVEILLANCE_TTL_MS = 10 * 60_000;
/** Max cache entries before the oldest is evicted. */
const MAX_ENTRIES = 64;
/** Hard cap on returned features (protects memory / payloads). */
const MAX_FEATURES = 20_000;

export type SurveillanceFetcher = (
  bbox: BBox,
  categories: SurveillanceCategory[],
  log: (m: string) => void,
) => Promise<CameraFeature[]>;

export interface SurveillanceOptions {
  /** ALPR source (defaults to the process-wide camera store). */
  store?: Pick<CameraStore, 'query'>;
  /** Live fetcher for non-ALPR categories (defaults to Overpass). Injectable for tests. */
  fetcher?: SurveillanceFetcher;
  /** Cache TTL in ms (defaults to SURVEILLANCE_TTL_MS). */
  ttlMs?: number;
  /** Clock (defaults to Date.now). Injectable for tests. */
  now?: () => number;
  /** Cap on returned features (defaults to MAX_FEATURES). */
  maxFeatures?: number;
}

interface CacheEntry {
  at: number;
  features: CameraFeature[];
}

const cache = new Map<string, CacheEntry>();

function roundBbox(b: BBox): string {
  return b.map((n) => Math.round(n * 1000) / 1000).join(',');
}

/** Clear the per-bbox surveillance cache (test hook). */
export function clearSurveillanceCache(): void {
  cache.clear();
}

/**
 * Surveillance features for `bbox` across the requested `categories`. ALPR is
 * served from the in-memory camera store; every other category is fetched live
 * from Overpass and cached per rounded-bbox + sorted-categories with a TTL and
 * a modest entry cap (oldest evicted). Returns at most `maxFeatures` features,
 * logging if truncated. The fetcher, TTL, and clock are injectable so tests
 * never touch the network.
 */
export async function getSurveillance(
  bbox: BBox,
  categories: SurveillanceCategory[],
  log: (m: string) => void = () => {},
  opts: SurveillanceOptions = {},
): Promise<CameraFeature[]> {
  const store = opts.store ?? cameraStore;
  const fetcher = opts.fetcher ?? ((b, cats, l) => fetchSurveillance(b, cats, { log: l }));
  const ttlMs = opts.ttlMs ?? SURVEILLANCE_TTL_MS;
  const now = opts.now ?? Date.now;
  const maxFeatures = opts.maxFeatures ?? MAX_FEATURES;

  const wanted = [...new Set(categories)];
  const out: CameraFeature[] = [];
  if (wanted.includes('alpr')) out.push(...store.query(bbox));

  const others = wanted.filter((c) => c !== 'alpr').sort();
  if (others.length > 0) {
    const key = `${roundBbox(bbox)}|${others.join(',')}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) {
      out.push(...hit.features);
    } else {
      const fetched = await fetcher(bbox, others, log);
      cache.set(key, { at: now(), features: fetched });
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      out.push(...fetched);
    }
  }

  if (out.length > maxFeatures) {
    log(`surveillance: truncating ${out.length} features to ${maxFeatures}`);
    return out.slice(0, maxFeatures);
  }
  return out;
}
