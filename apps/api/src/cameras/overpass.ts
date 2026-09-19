import type { BBox, CameraFeature, SurveillanceCategory } from '@elude/shared';
import { config } from '../config.js';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  timestamp?: string;
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OverpassOptions {
  urls?: string[];
  /** Max tile size in degrees before splitting the bbox into a grid. */
  maxTileDeg?: number;
  retries?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

/** Overpass QL for ALPR cameras inside a bbox ([w,s,e,n]). */
export function buildQuery(bbox: BBox): string {
  const [w, s, e, n] = bbox;
  return `[out:json][timeout:180]; nwr["surveillance:type"~"ALPR"](${s},${w},${n},${e}); out center meta;`;
}

/**
 * Overpass QL for the requested surveillance categories inside a bbox. Note the
 * cctv clause (`man_made=surveillance`) also returns ALPR/speed nodes; callers
 * should re-categorise and keep only the requested categories.
 */
export function buildCategoryQuery(bbox: BBox, categories: SurveillanceCategory[]): string {
  const [w, s, e, n] = bbox;
  const b = `(${s},${w},${n},${e})`;
  const set = new Set(categories);
  const clauses: string[] = [];
  if (set.has('alpr')) clauses.push(`nwr["surveillance:type"~"ALPR",i]${b};`);
  if (set.has('speed')) {
    clauses.push(`node["highway"="speed_camera"]${b};`);
    clauses.push(`nwr["enforcement"~"maxspeed|average_speed|speed",i]${b};`);
  }
  if (set.has('redlight')) clauses.push(`nwr["enforcement"~"traffic_signals|red_light",i]${b};`);
  if (set.has('cctv')) clauses.push(`nwr["man_made"="surveillance"]${b};`);
  return `[out:json][timeout:180]; (${clauses.join('')}); out center meta;`;
}

/**
 * Derive a surveillance category from raw OSM tags. Order matters: ALPR wins,
 * then speed, then red-light, else generic CCTV.
 */
export function categoriseTags(tags: Record<string, string>): SurveillanceCategory {
  const stype = tags['surveillance:type'] ?? '';
  const enforcement = tags.enforcement ?? '';
  const highway = tags.highway ?? '';
  if (/ALPR/i.test(stype)) return 'alpr';
  if (highway === 'speed_camera' || /maxspeed|average_speed|speed/i.test(enforcement) || /speed/i.test(stype)) {
    return 'speed';
  }
  if (/traffic_signals|red_light/i.test(enforcement) || /traffic_signals/i.test(stype)) return 'redlight';
  return 'cctv';
}

/** Split a bbox into tiles no larger than maxDeg x maxDeg. */
export function splitBbox(bbox: BBox, maxDeg: number): BBox[] {
  const [w, s, e, n] = bbox;
  const cols = Math.max(1, Math.ceil((e - w) / maxDeg));
  const rows = Math.max(1, Math.ceil((n - s) / maxDeg));
  if (cols === 1 && rows === 1) return [bbox];
  const dx = (e - w) / cols;
  const dy = (n - s) / rows;
  const tiles: BBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push([w + c * dx, s + r * dy, w + (c + 1) * dx, s + (r + 1) * dy]);
    }
  }
  return tiles;
}

const CARDINAL: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

/**
 * Parse a raw `direction` / `camera:direction` tag value into compass degrees
 * [0,360). Deliberately conservative: any ambiguity — ranges ("90-180"),
 * semicolon/comma multi-values ("45;225"), or junk — returns undefined, which
 * is treated as omnidirectional (the pre-existing behaviour).
 * Accepted: a single signed decimal number (normalized to [0,360)), the same
 * with a trailing "°" suffix, or a 16-wind cardinal ("N", "ENE", "south",
 * "north-east", case-insensitive).
 */
export function parseDirectionValue(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim();
  if (s === '') return undefined;
  // single clean value with a degree suffix, e.g. "360°"
  s = s.replace(/\s*°\s*$/, '');
  // strict numeric: the whole string must be one signed decimal number
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return undefined;
    return ((n % 360) + 360) % 360;
  }
  // 16-wind cardinal; also accept spelled-out words ("south", "North-East")
  const key = s
    .toUpperCase()
    .replace(/[\s_-]/g, '')
    .replace(/NORTH/g, 'N')
    .replace(/EAST/g, 'E')
    .replace(/SOUTH/g, 'S')
    .replace(/WEST/g, 'W');
  return CARDINAL[key];
}

/** Parse `direction` / `camera:direction` tags (camera:direction preferred). */
export function parseDirection(tags: Record<string, string> | undefined): number | undefined {
  if (!tags) return undefined;
  return parseDirectionValue(tags['camera:direction'] ?? tags.direction);
}

export function elementToFeature(el: OverpassElement): CameraFeature | null {
  const lat = el.type === 'node' ? el.lat : el.center?.lat;
  const lon = el.type === 'node' ? el.lon : el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const tags = el.tags ?? {};
  const feature: CameraFeature = {
    type: 'Feature',
    id: `${el.type}/${el.id}`,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id: el.id,
      osmType: el.type,
      tags,
    },
  };
  feature.properties.category = categoriseTags(tags);
  const manufacturer = tags.manufacturer ?? tags.brand;
  if (manufacturer) feature.properties.manufacturer = manufacturer;
  if (tags.operator) feature.properties.operator = tags.operator;
  const direction = parseDirection(tags);
  if (direction !== undefined) feature.properties.direction = direction;
  if (el.timestamp) feature.properties.timestamp = el.timestamp;
  return feature;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTile(
  query: string,
  urls: string[],
  retries: number,
  timeoutMs: number,
  log: (msg: string) => void,
): Promise<OverpassElement[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const url of urls) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': config.userAgent,
          },
          body: 'data=' + encodeURIComponent(query),
          signal: ac.signal,
        });
        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
          lastErr = new Error(`Overpass ${url} responded ${res.status}`);
          log(`overpass: ${url} -> ${res.status}, trying next mirror`);
          continue;
        }
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300);
          throw new Error(`Overpass ${url} responded ${res.status}: ${text}`);
        }
        const json = (await res.json()) as OverpassResponse;
        if (!Array.isArray(json.elements)) throw new Error('Overpass: malformed response');
        return json.elements;
      } catch (err) {
        lastErr = err;
        log(`overpass: ${url} failed: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    if (attempt < retries) {
      const backoff = 5000 * 2 ** attempt;
      log(`overpass: all mirrors failed, retrying in ${backoff} ms`);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass fetch failed');
}

/**
 * Fetch all ALPR cameras inside `bbox` from Overpass. Large regions are split
 * into a grid of tiles and merged (deduplicated by type/id).
 */
export async function fetchCameras(bbox: BBox, opts: OverpassOptions = {}): Promise<CameraFeature[]> {
  const urls = opts.urls ?? config.overpassUrls;
  const maxTileDeg = opts.maxTileDeg ?? 12;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const log = opts.log ?? (() => {});
  const tiles = splitBbox(bbox, maxTileDeg);
  // Pace multi-tile fetches to stay under Overpass rate limits; be gentler the
  // more tiles there are (e.g. a whole-country grid).
  const gapMs = tiles.length > 8 ? 4000 : tiles.length > 3 ? 2500 : 1500;
  const seen = new Map<string, CameraFeature>();
  let failed = 0;
  for (const [i, tile] of tiles.entries()) {
    log(`overpass: fetching tile ${i + 1}/${tiles.length} [${tile.map((n) => n.toFixed(2)).join(',')}]`);
    try {
      const elements = await fetchTile(buildQuery(tile), urls, retries, timeoutMs, log);
      for (const el of elements) {
        const f = elementToFeature(el);
        if (f) seen.set(`${el.type}/${el.id}`, f);
      }
    } catch (err) {
      // A single flaky tile must not wipe the whole fetch (critical for large,
      // many-tile regions like the whole US). Keep what we have and move on.
      failed++;
      log(`overpass: tile ${i + 1}/${tiles.length} failed after retries: ${(err as Error).message}`);
    }
    if (tiles.length > 1 && i < tiles.length - 1) await sleep(gapMs);
  }
  if (failed === tiles.length) {
    throw new Error(`Overpass: all ${tiles.length} tile(s) failed`);
  }
  if (failed > 0) {
    log(`overpass: ${failed}/${tiles.length} tiles failed; returning ${seen.size} cameras (partial)`);
  }
  return [...seen.values()];
}

/**
 * Fetch surveillance features of the given `categories` inside `bbox` from
 * Overpass. Large regions are split into a grid and merged (deduplicated by
 * type/id). Because the cctv clause also returns ALPR/speed nodes, each feature
 * is re-categorised and only those whose derived category is in the requested
 * set are kept, so per-category counts stay clean.
 */
export async function fetchSurveillance(
  bbox: BBox,
  categories: SurveillanceCategory[],
  opts: OverpassOptions = {},
): Promise<CameraFeature[]> {
  const urls = opts.urls ?? config.overpassUrls;
  const maxTileDeg = opts.maxTileDeg ?? 12;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const log = opts.log ?? (() => {});
  const wanted = new Set(categories);
  if (wanted.size === 0) return [];
  const tiles = splitBbox(bbox, maxTileDeg);
  const seen = new Map<string, CameraFeature>();
  for (const [i, tile] of tiles.entries()) {
    log(`overpass: fetching surveillance tile ${i + 1}/${tiles.length} [${tile.map((n) => n.toFixed(2)).join(',')}]`);
    const elements = await fetchTile(buildCategoryQuery(tile, categories), urls, retries, timeoutMs, log);
    for (const el of elements) {
      const f = elementToFeature(el);
      if (f && wanted.has(f.properties.category ?? 'alpr')) seen.set(`${el.type}/${el.id}`, f);
    }
    if (tiles.length > 1 && i < tiles.length - 1) await sleep(1500);
  }
  return [...seen.values()];
}
