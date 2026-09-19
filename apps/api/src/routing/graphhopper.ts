import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { BBox, Instruction, LngLat } from '@elude/shared';
import { config } from '../config.js';
import { AVOID_AREA_ID, type AvoidFeature } from './avoidGeometry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomModel {
  priority?: Array<Record<string, string | number>>;
  speed?: Array<Record<string, string | number>>;
  distance_influence?: number;
  areas?: { type: 'FeatureCollection'; features: Feature<MultiPolygon | Polygon>[] };
}

export interface GHRouteParams {
  /** [origin, ...waypoints, destination] — at least two points */
  points: LngLat[];
  customModel?: CustomModel;
  /** override for tests / self-test */
  timeoutMs?: number;
}

/** [fromIndex, toIndex, value] */
export type PathDetail = [number, number, string | number | null];

export interface GHPath {
  points: LngLat[];
  distance: number;
  time: number;
  bbox: BBox;
  instructions: Instruction[];
  snappedWaypoints: LngLat[];
  details: Record<string, PathDetail[]>;
}

export class GHError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'unreachable' | 'bad_request' | 'server' | 'timeout',
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'GHError';
  }
}

export interface GraphHopperClient {
  route(params: GHRouteParams): Promise<GHPath | null>;
  health(): Promise<{ ok: boolean; message?: string }>;
}

// ---------------------------------------------------------------------------
// Custom model helpers
// ---------------------------------------------------------------------------

/** One avoid area plus how it should influence priority. */
export interface AvoidEntry {
  area: AvoidFeature;
  factor: number;
  /**
   * When true the area is a hard block (`in_<id>` → 0) with NO bridge/tunnel
   * exemption — user-drawn zones block regardless of road level. When falsy the
   * area gets the camera rules (bridge/tunnel softened, else_if → factor).
   */
  hardBlock?: boolean;
}

/**
 * Custom model combining any number of avoid areas, each with its own rules,
 * into a single FeatureCollection. The priority array is order-sensitive: each
 * area's bridge/tunnel `if` is emitted before its `else_if in_<id>`, and each
 * area starts a fresh `if` so chains never collide. Distinct `in_<id>` names
 * (feature ids) keep the areas independent.
 */
export function avoidCustomModelMulti(entries: AvoidEntry[]): CustomModel {
  const priority: Array<Record<string, string | number>> = [];
  const features: AvoidFeature[] = [];
  for (const { area, factor, hardBlock } of entries) {
    const id = typeof area.id === 'string' ? area.id : AVOID_AREA_ID;
    features.push({ ...area, id });
    if (hardBlock) {
      // User zones: block at any level (no bridge/tunnel exemption).
      priority.push({ if: `in_${id}`, multiply_by: 0 });
    } else {
      priority.push({
        if: `in_${id} && (road_environment == BRIDGE || road_environment == TUNNEL)`,
        multiply_by: factor > 0 ? Math.min(1, Math.max(factor, 0.1)) : 0.1,
      });
      priority.push({ else_if: `in_${id}`, multiply_by: factor });
    }
  }
  return { priority, areas: { type: 'FeatureCollection', features } };
}

/**
 * Custom model that multiplies priority inside the avoid area by `factor`
 * (0 = block). Bridges/tunnels inside the area only get 0.1, since a camera
 * on the road below/above may not see the vehicle. Thin wrapper over
 * {@link avoidCustomModelMulti} for the single-camera-area case.
 */
export function avoidCustomModel(area: AvoidFeature, factor: number): CustomModel {
  return avoidCustomModelMulti([{ area, factor }]);
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

interface GHRawResponse {
  paths?: Array<{
    distance: number;
    time: number;
    bbox: BBox;
    points: { type: string; coordinates: number[][] };
    snapped_waypoints?: { type: string; coordinates: number[][] };
    instructions?: Array<{
      text: string;
      street_name?: string;
      distance: number;
      time: number;
      sign: number;
      interval: [number, number];
      exit_number?: number;
      turn_angle?: number;
      exited?: boolean;
    }>;
    details?: Record<string, PathDetail[]>;
  }>;
  message?: string;
  hints?: Array<{ message?: string; details?: string }>;
}

const NO_ROUTE_PATTERNS = [
  /connection between locations not found/i,
  /ConnectionNotFoundException/i,
  /MaximumNodesExceededException/i,
  /maximum nodes exceeded/i,
];

function isNoRoute(body: GHRawResponse | undefined): boolean {
  if (!body) return false;
  const texts = [body.message ?? '', ...(body.hints ?? []).flatMap((h) => [h.message ?? '', h.details ?? ''])];
  return texts.some((t) => NO_ROUTE_PATTERNS.some((re) => re.test(t)));
}

export function parseGHPath(raw: NonNullable<GHRawResponse['paths']>[number]): GHPath {
  return {
    points: raw.points.coordinates.map((c) => [c[0]!, c[1]!] as LngLat),
    distance: raw.distance,
    time: raw.time,
    bbox: raw.bbox,
    snappedWaypoints: (raw.snapped_waypoints?.coordinates ?? []).map((c) => [c[0]!, c[1]!] as LngLat),
    instructions: (raw.instructions ?? []).map((i) => {
      const ins: Instruction = {
        text: i.text,
        streetName: i.street_name ?? '',
        distance: i.distance,
        time: i.time,
        sign: i.sign,
        interval: i.interval,
      };
      if (i.exit_number !== undefined) ins.exitNumber = i.exit_number;
      if (i.turn_angle !== undefined) ins.turnAngle = i.turn_angle;
      if (i.exited !== undefined) ins.exited = i.exited;
      return ins;
    }),
    details: raw.details ?? {},
  };
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': config.userAgent },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    let json: unknown = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { message: text.slice(0, 500) };
    }
    return { status: res.status, json };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new GHError(`GraphHopper request timed out after ${timeoutMs} ms`, 504, 'timeout');
    }
    throw new GHError(`GraphHopper unreachable at ${config.ghUrl}: ${(err as Error).message}`, 502, 'unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export class HttpGraphHopperClient implements GraphHopperClient {
  constructor(
    private readonly baseUrl: string = config.ghUrl,
    private readonly profile: string = config.ghProfile,
  ) {}

  buildBody(params: GHRouteParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      profile: this.profile,
      points: params.points.map((p) => [p[0], p[1]]),
      'ch.disable': true,
      points_encoded: false,
      instructions: true,
      locale: 'en',
      details: ['road_environment', 'road_class', 'street_name'],
    };
    if (params.customModel) body.custom_model = params.customModel;
    return body;
  }

  async route(params: GHRouteParams): Promise<GHPath | null> {
    const { status, json } = await postJson(`${this.baseUrl}/route`, this.buildBody(params), params.timeoutMs ?? 60_000);
    const body = json as GHRawResponse;
    if (status === 200 && body?.paths?.length) {
      return parseGHPath(body.paths[0]!);
    }
    if (status === 400 && isNoRoute(body)) return null;
    const message = body?.message ?? `GraphHopper responded ${status}`;
    if (status >= 500) throw new GHError(message, status, 'server', body);
    throw new GHError(message, status || 502, 'bad_request', body);
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: ac.signal });
      if (res.ok) return { ok: true };
      return { ok: false, message: `GraphHopper /health responded ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level client (swappable for tests)
// ---------------------------------------------------------------------------

let client: GraphHopperClient = new HttpGraphHopperClient();

export function getGraphHopperClient(): GraphHopperClient {
  return client;
}

export function setGraphHopperClient(c: GraphHopperClient): void {
  client = c;
}

export function routeGH(params: GHRouteParams): Promise<GHPath | null> {
  return client.route(params);
}

export function ghHealth(): Promise<{ ok: boolean; message?: string }> {
  return client.health();
}

// ---------------------------------------------------------------------------
// MultiPolygon self-test
// ---------------------------------------------------------------------------

let multiPolygonSelfTest: boolean | undefined;

export function getMultiPolygonSelfTestResult(): boolean | undefined {
  return multiPolygonSelfTest;
}

/**
 * Verify that this GraphHopper build accepts a MultiPolygon in `custom_model.areas`.
 * Routes between two nearby points with an avoid area consisting of two tiny
 * far-away polygons. HTTP 200 (or a 400 that is merely "no connection"/"point not
 * found") means the area parsed fine; a 400 mentioning areas/polygons is a failure.
 */
export async function selfTestMultiPolygon(
  points?: [LngLat, LngLat],
  log: (msg: string) => void = (m) => console.log(m),
): Promise<boolean> {
  const [w, s, e, n] = config.regionBbox;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const pts: [LngLat, LngLat] = points ?? [
    [cx - 0.01, cy - 0.01],
    [cx + 0.01, cy + 0.01],
  ];
  const far1: LngLat = [w + 0.001, s + 0.001];
  const far2: LngLat = [e - 0.001, n - 0.001];
  const sq = (c: LngLat, d = 0.0002): number[][] => [
    [c[0] - d, c[1] - d],
    [c[0] + d, c[1] - d],
    [c[0] + d, c[1] + d],
    [c[0] - d, c[1] + d],
    [c[0] - d, c[1] - d],
  ];
  const area: AvoidFeature = {
    type: 'Feature',
    id: AVOID_AREA_ID,
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [[sq(far1)], [sq(far2)]] },
  };
  const model = avoidCustomModel(area, 0);
  const http = client instanceof HttpGraphHopperClient ? client : new HttpGraphHopperClient();
  try {
    const { status, json } = await postJson(
      `${config.ghUrl}/route`,
      http.buildBody({ points: pts, customModel: model }),
      30_000,
    );
    const body = json as GHRawResponse;
    if (status === 200) {
      multiPolygonSelfTest = true;
    } else if (status === 400) {
      const msg = [body?.message ?? '', ...(body?.hints ?? []).map((h) => `${h.message ?? ''} ${h.details ?? ''}`)].join(' ');
      const areaProblem = /area|polygon|in_cams|custom_model|custom model/i.test(msg);
      const benign = isNoRoute(body) || /PointNotFoundException|Cannot find point|PointOutOfBoundsException/i.test(msg);
      multiPolygonSelfTest = benign && !areaProblem;
      if (!multiPolygonSelfTest) log(`graphhopper: MultiPolygon self-test failed: ${msg}`);
    } else {
      multiPolygonSelfTest = false;
      log(`graphhopper: MultiPolygon self-test got HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
  } catch (err) {
    log(`graphhopper: MultiPolygon self-test error: ${(err as Error).message}`);
    multiPolygonSelfTest = undefined;
    return false;
  }
  log(`graphhopper: MultiPolygon areas self-test ${multiPolygonSelfTest ? 'OK' : 'FAILED'}`);
  return multiPolygonSelfTest;
}
