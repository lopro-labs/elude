import type {
  BBox,
  CameraFeature,
  LngLat,
  RouteKind,
  RouteMode,
  RoutePath,
  RouteRequest,
  RouteResponse,
  Strictness,
  SurveillanceCategory,
} from '@elude/shared';
import { config } from '../config.js';
import { cameraStore, type CameraStore } from '../cameras/store.js';
import { getSurveillance as defaultGetSurveillance } from '../cameras/surveillance.js';
import { routeSearchBbox } from '../util/geo.js';
import { buildAvoidArea, buildZonesArea, camerasContainingPoint, type AvoidFeature } from './avoidGeometry.js';
import {
  avoidCustomModelMulti,
  GHError,
  getGraphHopperClient,
  type AvoidEntry,
  type CustomModel,
  type GHPath,
  type GraphHopperClient,
} from './graphhopper.js';
import { analyseCrossings } from './crossings.js';

/** Fetch non-ALPR surveillance for a bbox (injectable so planner tests skip the network). */
export type GetSurveillance = (
  bbox: BBox,
  categories: SurveillanceCategory[],
  log: (m: string) => void,
) => Promise<CameraFeature[]>;

export class NoRouteError extends Error {
  constructor(message = 'No route found between the given points') {
    super(message);
    this.name = 'NoRouteError';
  }
}

export class GHUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GHUnavailableError';
  }
}

export interface PlannerDeps {
  gh?: GraphHopperClient;
  store?: Pick<CameraStore, 'query'>;
  /** Fetcher for non-ALPR surveillance categories; defaults to the real one. */
  getSurveillance?: GetSurveillance;
  log?: (msg: string) => void;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export interface NormalisedRequest {
  origin: RouteRequest['origin'];
  destination: RouteRequest['destination'];
  /** Intermediate stops between origin and destination, in order. */
  waypoints: LngLat[];
  bufferM: number;
  softFactor: number;
  strictness: Strictness;
  directionAware: boolean;
  manufacturer?: string;
  /** Surveillance categories to include in avoidance geometry (default ['alpr']). */
  avoidCategories: SurveillanceCategory[];
}

export function normaliseRequest(req: RouteRequest): NormalisedRequest {
  const cats = req.avoidCategories && req.avoidCategories.length > 0 ? [...new Set(req.avoidCategories)] : ['alpr'];
  const out: NormalisedRequest = {
    origin: req.origin,
    destination: req.destination,
    waypoints: req.waypoints ?? [],
    bufferM: clamp(req.bufferM ?? config.cameraBufferM ?? 30, 15, 150),
    softFactor: clamp(req.softFactor ?? 0.02, 0.001, 0.99),
    strictness: req.strictness ?? 'strict-then-fallback',
    directionAware: req.directionAware ?? true,
    avoidCategories: cats as SurveillanceCategory[],
  };
  const m = req.manufacturer?.trim();
  if (m) out.manufacturer = m;
  return out;
}

function toRoutePath(
  kind: RouteKind,
  p: GHPath,
  cameras: CameraFeature[],
  bufferM: number,
  directionAware: boolean,
): RoutePath {
  const { crossings, avoidedByDirection } = analyseCrossings(p, cameras, bufferM, directionAware);
  return {
    kind,
    points: p.points,
    distance: p.distance,
    time: p.time,
    bbox: p.bbox,
    instructions: p.instructions,
    camerasCrossed: crossings,
    avoidedByDirection,
    snappedWaypoints: p.snappedWaypoints,
  };
}

/** Wrap a GH call so that transport failures become GHUnavailableError. */
async function callGH(gh: GraphHopperClient, params: Parameters<GraphHopperClient['route']>[0]): Promise<GHPath | null> {
  try {
    return await gh.route(params);
  } catch (err) {
    if (err instanceof GHError && (err.kind === 'unreachable' || err.kind === 'timeout' || err.kind === 'server')) {
      throw new GHUnavailableError(err.message, err);
    }
    throw err;
  }
}

export async function planRoute(req: RouteRequest, deps: PlannerDeps = {}): Promise<RouteResponse> {
  const gh = deps.gh ?? getGraphHopperClient();
  const store = deps.store ?? cameraStore;
  const getSurveillance = deps.getSurveillance ?? defaultGetSurveillance;
  const log = deps.log ?? (() => {});
  const timings: Record<string, number> = {};
  const tAll = Date.now();

  const n = normaliseRequest(req);
  const { origin, destination, waypoints, bufferM, softFactor, strictness, directionAware } = n;
  /** [origin, ...waypoints, destination] – shared by every GH pass. */
  const stops: LngLat[] = [origin, ...waypoints, destination];

  // Extra (non-ALPR) categories to fold into the avoidance set. Empty for the
  // default ['alpr'] request, so timings/behaviour match today exactly.
  const extraCategories = n.avoidCategories.filter((c) => c !== 'alpr');
  const dedupeById = (list: CameraFeature[]): CameraFeature[] => {
    const seen = new Set<string>();
    const out: CameraFeature[] = [];
    for (const c of list) {
      const key = `${c.properties.osmType}/${c.properties.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
    return out;
  };
  /** ALPR from the store plus, when requested, live extra-category surveillance. */
  const gatherCameras = async (searchBbox: BBox): Promise<CameraFeature[]> => {
    const alpr = store.query(searchBbox, n.manufacturer);
    if (extraCategories.length === 0) return alpr;
    const extra = await getSurveillance(searchBbox, extraCategories, log);
    return dedupeById([...alpr, ...extra]);
  };

  // 2. cameras in the search bbox
  let t0 = Date.now();
  const bbox = routeSearchBbox(stops);
  let cameras = await gatherCameras(bbox);
  timings.cameraQuery = Date.now() - t0;

  // User-drawn avoid zones (hard-blocked in every pass except the pure fastest baseline).
  const zonesArea = buildZonesArea(req.avoidZones ?? []);

  // 3. unavoidable cameras (buffer contains origin/waypoint/destination)
  const unavoidableIds = new Set<string>();
  const unavoidable: CameraFeature[] = [];
  for (const c of stops.flatMap((p) => camerasContainingPoint(cameras, p, bufferM))) {
    const key = `${c.properties.osmType}/${c.properties.id}`;
    if (!unavoidableIds.has(key)) {
      unavoidableIds.add(key);
      unavoidable.push(c);
    }
  }
  const strictCams = (list: CameraFeature[]): CameraFeature[] =>
    list.filter((c) => !unavoidableIds.has(`${c.properties.osmType}/${c.properties.id}`));

  // 4. avoid areas
  t0 = Date.now();
  const wantStrict = strictness === 'strict-then-fallback';
  const wantSoft = strictness !== 'none';
  let strictArea: AvoidFeature | null = wantStrict ? buildAvoidArea(strictCams(cameras), bufferM, directionAware) : null;
  const softArea: AvoidFeature | null = wantSoft ? buildAvoidArea(cameras, bufferM, directionAware) : null;
  timings.avoidGeometry = Date.now() - t0;

  const points: LngLat[] = stops;
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = Date.now() - s;
    }
  };

  /** Combine a camera area (with `camFactor`) and the zones area (always hard 0) into one model. */
  const buildModel = (camArea: AvoidFeature | null, camFactor: number): CustomModel | undefined => {
    const entries: AvoidEntry[] = [];
    if (camArea) entries.push({ area: camArea, factor: camFactor });
    if (zonesArea) entries.push({ area: zonesArea, factor: 0, hardBlock: true });
    return entries.length ? avoidCustomModelMulti(entries) : undefined;
  };

  const strictModel = buildModel(strictArea, 0);
  const softModel = buildModel(softArea, softFactor);
  // strictness=none with zones: one extra pass that only hard-avoids the zones.
  const zonesOnlyModel =
    strictness === 'none' && zonesArea
      ? avoidCustomModelMulti([{ area: zonesArea, factor: 0, hardBlock: true }])
      : undefined;

  // When there is nothing to avoid (no cameras and no zones), the strict/soft passes are
  // identical to the fastest pass, so we reuse it instead of issuing redundant GH requests.
  const fastestP = timed('fastest', () => callGH(gh, { points }));
  const strictP =
    wantStrict && strictModel
      ? timed('strict', () => callGH(gh, { points, customModel: strictModel }))
      : wantStrict
        ? fastestP
        : Promise.resolve<GHPath | null>(null);
  const softP =
    wantSoft && softModel
      ? timed('soft', () => callGH(gh, { points, customModel: softModel }))
      : wantSoft
        ? fastestP
        : Promise.resolve<GHPath | null>(null);
  const zonesOnlyP = zonesOnlyModel
    ? timed('zonesOnly', () => callGH(gh, { points, customModel: zonesOnlyModel }))
    : Promise.resolve<GHPath | null>(null);

  const settled = await Promise.allSettled([fastestP, strictP, softP, zonesOnlyP]);
  const firstFailure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (firstFailure) {
    const err = firstFailure.reason;
    if (err instanceof GHUnavailableError) throw err;
    // A GH validation error (bad request) on one pass – if the fastest pass failed too, surface it.
    if (settled[0].status === 'rejected') throw settled[0].reason;
    log(`planner: secondary pass failed: ${(err as Error).message}`);
  }
  const fastest = settled[0].status === 'fulfilled' ? settled[0].value : null;
  let strict = settled[1].status === 'fulfilled' ? settled[1].value : null;
  const soft = settled[2].status === 'fulfilled' ? settled[2].value : null;
  const zonesOnly = settled[3].status === 'fulfilled' ? settled[3].value : null;

  // Strict failed → retry once with a 3x larger search bbox (more cameras to avoid, but
  // GraphHopper may find a longer detour that leaves the original bbox). Zones are folded in too.
  if (wantStrict && strict === null && strictArea) {
    const bigBbox = routeSearchBbox(stops, 0.2, 15_000, 3);
    const bigCams = await gatherCameras(bigBbox);
    if (bigCams.length > cameras.length) {
      cameras = bigCams;
      strictArea = buildAvoidArea(strictCams(bigCams), bufferM, directionAware);
      const retryModel = buildModel(strictArea, 0);
      strict = await timed('strictRetry', () => callGH(gh, { points, customModel: retryModel }));
    }
  }

  if (!fastest && !strict && !soft && !zonesOnly) throw new NoRouteError();

  // 5. choose
  t0 = Date.now();
  let chosenRaw: GHPath;
  let chosenKind: RouteKind;
  let mode: RouteMode;
  if (strict) {
    chosenRaw = strict;
    chosenKind = 'strict';
    mode = 'strict';
  } else if (soft) {
    chosenRaw = soft;
    chosenKind = 'soft';
    mode = strictness === 'balanced' ? 'balanced' : 'fallback';
  } else if (zonesOnly) {
    // strictness=none with zones: the zone-avoiding path is the chosen route.
    chosenRaw = zonesOnly;
    chosenKind = 'fastest';
    mode = 'fastest-only';
  } else {
    chosenRaw = fastest!;
    chosenKind = 'fastest';
    mode = 'fastest-only';
  }
  const chosen = toRoutePath(chosenKind, chosenRaw, cameras, bufferM, directionAware);
  // Pure fastest comparison path: shown whenever it differs from the chosen route
  // (including strictness=none when zones pushed the chosen route off the fastest line).
  const fastestPath =
    !fastest || fastest === chosenRaw
      ? null
      : toRoutePath('fastest', fastest, cameras, bufferM, directionAware);
  // Soft alternative for comparison: only in strict-then-fallback mode, and only
  // when the soft pass produced a path that is not already the chosen one.
  const softPath =
    strictness === 'strict-then-fallback' && soft && soft !== chosenRaw
      ? toRoutePath('soft', soft, cameras, bufferM, directionAware)
      : null;
  timings.crossings = Date.now() - t0;
  timings.total = Date.now() - tAll;

  const avoidArea = (strict ? strictArea : softArea) ?? strictArea ?? softArea;
  const response: RouteResponse = {
    mode,
    chosen,
    fastest: fastestPath,
    soft: softPath,
    unavoidable,
    camerasConsidered: cameras.length,
    bufferM,
    timings,
  };
  if (avoidArea) response.avoidArea = avoidArea;
  return response;
}
