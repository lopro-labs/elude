import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Load `.env` from the repo root (dev script runs from apps/api) or from cwd
 * (docker / running from repo root). First one found wins; process env has
 * priority over file values (dotenv default).
 */
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
];
let envDir = process.cwd();
for (const p of candidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    envDir = path.dirname(p);
    break;
  }
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

/** [west, south, east, north] */
export type BBox4 = [number, number, number, number];

function parseRegionBbox(s: string): BBox4 {
  // env format: south,west,north,east
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid REGION_BBOX "${s}" (expected south,west,north,east)`);
  }
  const [s0, w, n, e] = parts as [number, number, number, number];
  return [w, s0, e, n];
}

const rawDataDir = str('DATA_DIR', './data');
const dataDir = path.isAbsolute(rawDataDir) ? rawDataDir : path.resolve(envDir, rawDataDir);

export const config = {
  ghUrl: str('GH_URL', 'http://127.0.0.1:8989').replace(/\/+$/, ''),
  ghProfile: str('GH_PROFILE', 'car'),
  regionBbox: parseRegionBbox(str('REGION_BBOX', '38.4,-75.8,39.9,-75.0')),
  cameraBufferM: num('CAMERA_BUFFER_M', 30),
  cameraRefreshHours: num('CAMERA_REFRESH_HOURS', 6),
  overpassUrls: str(
    'OVERPASS_URLS',
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  photonUrl: str('PHOTON_URL', 'https://photon.komoot.io').replace(/\/+$/, ''),
  nominatimUrl: str('NOMINATIM_URL', 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
  /** US Census geocoder base URL — free house-number fallback for US street addresses. */
  censusUrl: str('CENSUS_URL', 'https://geocoding.geo.census.gov').replace(/\/+$/, ''),
  /** Toggle the Census address fallback (GEOCODER_CENSUS=off to disable). */
  censusFallback: !['0', 'false', 'off', 'no'].includes(str('GEOCODER_CENSUS', 'on').toLowerCase()),
  /** CORS allow-list (comma-separated). Empty = reflect any origin (fine for a same-origin proxy deploy). */
  corsOrigin: str('CORS_ORIGIN', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Rate limiting: global cap and a stricter cap for the expensive route/geocode endpoints, per window. */
  rateLimitMax: num('RATE_LIMIT_MAX', 120),
  rateLimitRouteMax: num('RATE_LIMIT_ROUTE_MAX', 40),
  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
  port: num('API_PORT', 3210),
  dataDir,
  /** Directory of this package (apps/api) – used to locate the fallback snapshot. */
  packageDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  userAgent: 'elude/0.1 (self-hosted)',
  version: '0.1.0',
};

export type Config = typeof config;
