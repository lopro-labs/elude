/**
 * Mock API used when VITE_MOCK_API=1 so the UI can be exercised without the
 * backend / GraphHopper. Everything here is synthetic but shaped like the real
 * contract in @elude/shared.
 */
import type {
  BBox,
  CameraCollection,
  CameraFeature,
  CameraStats,
  CrossedCamera,
  GeocodeResult,
  HealthResponse,
  Instruction,
  LngLat,
  RoutePath,
  RouteRequest,
  RouteResponse,
} from '@elude/shared';
import { bboxOfPoints, cumulativeDistances, haversineM } from '../util/geo';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Deterministic PRNG so the map looks the same between reloads.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MANUFACTURERS = ['Flock Safety', 'Flock Safety', 'Flock Safety', 'Motorola Solutions', 'Genetec', 'Axon'];
const OPERATORS = ['City Police', 'County Sheriff', 'State Police', 'Dept. of Transportation', 'HOA', 'Transit Authority'];

// Clouds of cameras around several US metros so any national view has some.
const CENTERS: LngLat[] = [
  [-74.006, 40.7128], // New York
  [-87.6298, 41.8781], // Chicago
  [-95.3698, 29.7604], // Houston
  [-112.074, 33.4484], // Phoenix
  [-104.9903, 39.7392], // Denver
  [-84.388, 33.749], // Atlanta
  [-122.3321, 47.6062], // Seattle
];

let cameraCache: CameraFeature[] | null = null;
function allCameras(): CameraFeature[] {
  if (cameraCache) return cameraCache;
  const rnd = mulberry32(42);
  const out: CameraFeature[] = [];
  let id = 10_000_000;
  for (const [cx, cy] of CENTERS) {
    for (let i = 0; i < 260; i++) {
      const r = (rnd() + rnd() + rnd()) / 3;
      const a = rnd() * Math.PI * 2;
      const lon = cx + Math.cos(a) * r * 0.5;
      const lat = cy + Math.sin(a) * r * 0.35;
      const manufacturer = MANUFACTURERS[Math.floor(rnd() * MANUFACTURERS.length)];
      const operator = OPERATORS[Math.floor(rnd() * OPERATORS.length)];
      const direction = Math.round(rnd() * 360);
      const roll = rnd();
      const category = roll < 0.7 ? 'alpr' : roll < 0.8 ? 'speed' : roll < 0.88 ? 'redlight' : 'cctv';
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          id: id++,
          osmType: 'node',
          category,
          manufacturer,
          operator,
          direction,
          timestamp: new Date(Date.now() - rnd() * 400 * 86400_000).toISOString(),
          tags: {
            man_made: 'surveillance',
            'surveillance:type': 'ALPR',
            surveillance: 'public',
            manufacturer,
            operator,
            direction: String(direction),
          },
        },
      });
    }
  }
  cameraCache = out;
  return out;
}

export async function getHealth(): Promise<HealthResponse> {
  await delay(120);
  return {
    ok: true,
    graphhopper: { ok: true, url: 'http://mock:8989', multiPolygonAreasOk: true },
    cameras: await getCameraStats(),
    version: 'mock',
  };
}

export async function getCameraStats(): Promise<CameraStats> {
  await delay(80);
  const cams = allCameras();
  const manufacturers: Record<string, number> = {};
  for (const c of cams) {
    const m = c.properties.manufacturer ?? 'unknown';
    manufacturers[m] = (manufacturers[m] ?? 0) + 1;
  }
  return { count: cams.length, fetchedAt: new Date(Date.now() - 3600_000 * 2).toISOString(), source: 'cache', manufacturers };
}

export async function getCameras(bbox: BBox, categories?: string[]): Promise<CameraCollection> {
  await delay(150);
  const [w, s, e, n] = bbox;
  const cats = categories && categories.length ? new Set(categories) : new Set(['alpr']);
  const features = allCameras().filter((c) => {
    const [x, y] = c.geometry.coordinates;
    if (x < w || x > e || y < s || y > n) return false;
    return cats.has(c.properties.category ?? 'alpr');
  });
  return { type: 'FeatureCollection', features };
}

function makePath(kind: RoutePath['kind'], origin: LngLat, destination: LngLat, wobble: number, seed: number): RoutePath {
  const rnd = mulberry32(seed);
  const n = 40;
  const points: LngLat[] = [];
  const dx = destination[0] - origin[0];
  const dy = destination[1] - origin[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bump = Math.sin(t * Math.PI) * wobble * len + (rnd() - 0.5) * 0.004 * (i > 0 && i < n ? 1 : 0);
    points.push([origin[0] + dx * t + px * bump, origin[1] + dy * t + py * bump]);
  }
  points[0] = origin;
  points[n] = destination;
  const cum = cumulativeDistances(points);
  const distance = cum[n];
  const speedMps = kind === 'fastest' ? 21 : 19;
  const time = (distance / speedMps) * 1000;

  const streets = ['Capitol Mall', 'I-80 W', 'CA-99 S', 'J Street', 'Broadway', 'Folsom Blvd', 'Watt Ave', 'Fair Oaks Blvd', 'US-50 E'];
  const signs = [0, 2, -2, 7, 1, -1, 6, 3, -7];
  const instructions: Instruction[] = [];
  const stepCount = 8;
  for (let s = 0; s < stepCount; s++) {
    const a = Math.floor((s / stepCount) * n);
    const b = Math.floor(((s + 1) / stepCount) * n);
    const street = streets[(s + seed) % streets.length];
    const sign = s === 0 ? 0 : signs[(s + seed) % signs.length];
    const dist = cum[b] - cum[a];
    let text: string;
    if (s === 0) text = `Head ${dx > 0 ? 'east' : 'west'} on ${street}`;
    else if (sign === 6) text = `At the roundabout, take the 2nd exit onto ${street}`;
    else if (sign === 7) text = `Keep right onto ${street}`;
    else if (sign === -7) text = `Keep left onto ${street}`;
    else if (sign > 0) text = `Turn ${sign === 1 ? 'slight ' : sign === 3 ? 'sharp ' : ''}right onto ${street}`;
    else text = `Turn ${sign === -1 ? 'slight ' : sign === -3 ? 'sharp ' : ''}left onto ${street}`;
    instructions.push({
      text,
      streetName: street,
      distance: dist,
      time: (dist / speedMps) * 1000,
      sign,
      interval: [a, b],
      ...(sign === 6 ? { exitNumber: 2 } : {}),
    });
  }
  instructions.push({ text: 'Arrive at destination', streetName: '', distance: 0, time: 0, sign: 4, interval: [n, n] });

  const cams = allCameras();
  const crossed: CrossedCamera[] = [];
  const wanted = kind === 'fastest' ? 3 : kind === 'soft' ? 1 : 0;
  for (let k = 0; k < wanted; k++) {
    const idx = Math.floor(((k + 1) / (wanted + 1)) * n);
    const p = points[idx];
    let best: CameraFeature | null = null;
    let bestD = Infinity;
    for (const c of cams) {
      const d = haversineM(p, c.geometry.coordinates as LngLat);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      crossed.push({
        id: best.properties.id,
        lngLat: p,
        manufacturer: best.properties.manufacturer,
        osmType: best.properties.osmType,
        operator: best.properties.operator,
        direction: best.properties.direction,
        distanceM: 6 + k * 4,
        pathIndex: idx,
        possiblyNotVisible: k === 1,
      });
    }
  }

  return {
    kind,
    points,
    distance,
    time,
    bbox: bboxOfPoints(points),
    instructions,
    camerasCrossed: crossed,
    snappedWaypoints: [origin, destination],
  };
}

/** Chain makePath across origin → waypoints → destination, merging legs into one RoutePath. */
function makeMultiPath(kind: RoutePath['kind'], anchors: LngLat[], wobble: number, seed: number): RoutePath {
  const legs = anchors.slice(1).map((dest, i) => makePath(kind, anchors[i], dest, wobble, seed + i * 11));
  if (legs.length === 1) return legs[0];
  const points: LngLat[] = [];
  const instructions: Instruction[] = [];
  const camerasCrossed: CrossedCamera[] = [];
  let offset = 0;
  let distance = 0;
  let time = 0;
  legs.forEach((leg, i) => {
    const legPoints = i === 0 ? leg.points : leg.points.slice(1);
    points.push(...legPoints);
    const ins = i < legs.length - 1 ? leg.instructions.slice(0, -1) : leg.instructions; // drop intermediate "Arrive"
    for (const it of ins) instructions.push({ ...it, interval: [it.interval[0] + offset, it.interval[1] + offset] });
    if (i < legs.length - 1) {
      const at = offset + leg.points.length - 1;
      instructions.push({ text: `Stop ${i + 1}`, streetName: '', distance: 0, time: 0, sign: 5, interval: [at, at] });
    }
    for (const c of leg.camerasCrossed) camerasCrossed.push({ ...c, pathIndex: c.pathIndex + offset });
    offset += leg.points.length - 1;
    distance += leg.distance;
    time += leg.time;
  });
  return {
    kind,
    points,
    distance,
    time,
    bbox: bboxOfPoints(points),
    instructions,
    camerasCrossed,
    snappedWaypoints: anchors,
  };
}

export async function postRoute(req: RouteRequest): Promise<RouteResponse> {
  await delay(650);
  const strictness = req.strictness ?? 'strict-then-fallback';
  const anchors: LngLat[] = [req.origin, ...(req.waypoints ?? []), req.destination];
  const directionAware = req.directionAware !== false;
  const fastest = makeMultiPath('fastest', anchors, 0.02, 7);
  const bufferM = req.bufferM ?? 30;
  if (strictness === 'none') {
    return { mode: 'fastest-only', chosen: fastest, fastest: null, unavoidable: [], camerasConsidered: 0, bufferM, timings: { total: 120 } };
  }
  const chosen = makeMultiPath(strictness === 'balanced' ? 'soft' : 'strict', anchors, 0.16, 3);
  chosen.avoidedByDirection = directionAware ? 2 : 0;
  fastest.avoidedByDirection = directionAware ? 1 : 0;
  const soft = strictness === 'balanced' ? null : makeMultiPath('soft', anchors, 0.09, 5);
  if (soft) soft.avoidedByDirection = directionAware ? 1 : 0;
  const mode: RouteResponse['mode'] = strictness === 'balanced' ? 'balanced' : 'strict';
  const d = 0.0025;
  const avoidArea: RouteResponse['avoidArea'] = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: fastest.camerasCrossed.map((c) => [
        [
          [c.lngLat[0] - d, c.lngLat[1] - d],
          [c.lngLat[0] + d, c.lngLat[1] - d],
          [c.lngLat[0] + d, c.lngLat[1] + d],
          [c.lngLat[0] - d, c.lngLat[1] + d],
          [c.lngLat[0] - d, c.lngLat[1] - d],
        ],
      ]),
    },
  };
  return {
    mode,
    chosen,
    fastest,
    soft,
    unavoidable: [],
    camerasConsidered: 128,
    bufferM,
    timings: { cameras: 12, strict: 410, fastest: 95, total: 640 },
    avoidArea,
  };
}

const PLACES: GeocodeResult[] = [
  { label: 'New York, NY, USA', name: 'New York', lngLat: [-74.006, 40.7128], city: 'New York', state: 'New York', country: 'USA', type: 'city' },
  { label: 'Chicago, IL, USA', name: 'Chicago', lngLat: [-87.6298, 41.8781], city: 'Chicago', state: 'Illinois', type: 'city' },
  { label: 'Houston, TX, USA', name: 'Houston', lngLat: [-95.3698, 29.7604], city: 'Houston', state: 'Texas', type: 'city' },
  { label: 'Phoenix, AZ, USA', name: 'Phoenix', lngLat: [-112.074, 33.4484], city: 'Phoenix', state: 'Arizona', type: 'city' },
  { label: 'Denver, CO, USA', name: 'Denver', lngLat: [-104.9903, 39.7392], city: 'Denver', state: 'Colorado', type: 'city' },
  { label: 'Atlanta, GA, USA', name: 'Atlanta', lngLat: [-84.388, 33.749], city: 'Atlanta', state: 'Georgia', type: 'city' },
  { label: 'Seattle, WA, USA', name: 'Seattle', lngLat: [-122.3321, 47.6062], city: 'Seattle', state: 'Washington', type: 'city' },
  { label: 'Miami, FL, USA', name: 'Miami', lngLat: [-80.1918, 25.7617], city: 'Miami', state: 'Florida', type: 'city' },
  { label: 'Boston, MA, USA', name: 'Boston', lngLat: [-71.0589, 42.3601], city: 'Boston', state: 'Massachusetts', type: 'city' },
  { label: 'Austin, TX, USA', name: 'Austin', lngLat: [-97.7431, 30.2672], city: 'Austin', state: 'Texas', type: 'city' },
];

export async function geocode(q: string): Promise<GeocodeResult[]> {
  await delay(180);
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return PLACES.filter((p) => p.label.toLowerCase().includes(needle)).slice(0, 6);
}

export async function reverseGeocode(lngLat: LngLat): Promise<GeocodeResult | null> {
  await delay(150);
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d = haversineM(p.lngLat, lngLat);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  const km = Math.round(bestD / 1000);
  const near = km < 2;
  return { ...best, label: near ? best.label : `${km} km from ${best.name}`, name: near ? best.name : `Near ${best.name}`, lngLat };
}
