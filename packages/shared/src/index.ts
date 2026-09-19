/**
 * Shared contract between the Elude API and web app.
 * Coordinates are always [longitude, latitude] (GeoJSON order).
 */
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';

export type LngLat = [number, number];
/** [west, south, east, north] */
export type BBox = [number, number, number, number];

// ---------------------------------------------------------------------------
// Cameras (from DeFlock / OpenStreetMap: surveillance:type=ALPR)
// ---------------------------------------------------------------------------

/**
 * Kind of surveillance device. Today only ALPR is fetched region-wide; the
 * other categories are fetched lazily per-bbox for display / optional avoidance.
 */
export type SurveillanceCategory = 'alpr' | 'speed' | 'redlight' | 'cctv';

export interface CameraProperties {
  /** OSM element id */
  id: number;
  osmType: 'node' | 'way' | 'relation';
  /** Surveillance category; absent means treat as 'alpr' (back-compat). */
  category?: SurveillanceCategory;
  manufacturer?: string;
  operator?: string;
  /** Compass heading the camera faces, degrees, if tagged (direction / camera:direction) */
  direction?: number;
  /** ISO timestamp of the OSM element version, if available */
  timestamp?: string;
  /** All raw OSM tags */
  tags: Record<string, string>;
}

export type CameraFeature = Feature<Point, CameraProperties>;
export type CameraCollection = FeatureCollection<Point, CameraProperties>;

export interface CameraStats {
  count: number;
  /** ISO timestamp of the last successful fetch from Overpass (or fallback snapshot) */
  fetchedAt: string | null;
  source: 'overpass' | 'cache' | 'fallback';
  manufacturers: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type Strictness =
  /** Try zero-camera route (any detour); fall back to fewest-camera route. */
  | 'strict-then-fallback'
  /** Single penalized route; avoids cameras unless the detour becomes very large. */
  | 'balanced'
  /** Ignore cameras entirely (fastest route only). */
  | 'none';

export interface RouteOptions {
  /** Buffer radius around each camera in metres. Default 30, range 15–150. */
  bufferM?: number;
  /**
   * Priority factor for the soft/balanced pass, (0,1]. Lower = stronger avoidance.
   * Default 0.02.
   */
  softFactor?: number;
  strictness?: Strictness;
  /** Only avoid cameras whose manufacturer tag matches (case-insensitive substring), e.g. "Flock". */
  manufacturer?: string;
  /**
   * When true (default, also applied when undefined), cameras with a known
   * facing (`direction`) only block/count in their front half – passing behind
   * a one-directional ALPR is allowed. Set false to treat every camera as
   * omnidirectional.
   */
  directionAware?: boolean;
}

/**
 * A user-drawn zone the route must hard-avoid, independent of cameras
 * (checkpoints, neighbourhoods, a toll gantry). Circle = a centre + radius;
 * polygon = an ordered ring of points.
 */
export type AvoidZone =
  | { type: 'circle'; center: LngLat; radiusM: number }
  | { type: 'polygon'; points: LngLat[] };

export interface RouteRequest extends RouteOptions {
  origin: LngLat;
  destination: LngLat;
  /** Intermediate stops, in order, between origin and destination (max 8). */
  waypoints?: LngLat[];
  /** User-drawn zones the route must hard-avoid, in order (max 20). */
  avoidZones?: AvoidZone[];
  /** Which surveillance categories to include in avoidance geometry (default ['alpr']). */
  avoidCategories?: SurveillanceCategory[];
}

/**
 * GraphHopper instruction sign codes.
 * https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md#instructions
 */
export const enum InstructionSign {
  UTurnUnknown = -98,
  UTurnLeft = -8,
  KeepLeft = -7,
  LeaveRoundabout = -6,
  TurnSharpLeft = -3,
  TurnLeft = -2,
  TurnSlightLeft = -1,
  Continue = 0,
  TurnSlightRight = 1,
  TurnRight = 2,
  TurnSharpRight = 3,
  Finish = 4,
  ReachedVia = 5,
  UseRoundabout = 6,
  KeepRight = 7,
  UTurnRight = 8,
}

export interface Instruction {
  text: string;
  streetName: string;
  /** metres */
  distance: number;
  /** milliseconds */
  time: number;
  sign: number;
  /** [startIndex, endIndex] into RoutePath.points */
  interval: [number, number];
  exitNumber?: number;
  turnAngle?: number;
  exited?: boolean;
}

export interface CrossedCamera {
  id: number;
  lngLat: LngLat;
  manufacturer?: string;
  osmType?: 'node' | 'way' | 'relation';
  operator?: string;
  /** Compass heading the camera faces, degrees, if tagged */
  direction?: number;
  /** distance from camera to the route line, metres */
  distanceM: number;
  /** index into RoutePath.points nearest to the crossing */
  pathIndex: number;
  /** true when the crossing segment is a bridge/tunnel (camera may watch a different level) */
  possiblyNotVisible: boolean;
}

export type RouteKind = 'strict' | 'soft' | 'fastest';

export interface RoutePath {
  kind: RouteKind;
  points: LngLat[];
  /** metres */
  distance: number;
  /** milliseconds */
  time: number;
  bbox: BBox;
  instructions: Instruction[];
  camerasCrossed: CrossedCamera[];
  /**
   * Cameras the path passed within bufferM of that did NOT count as crossings
   * because they face away from the closest-approach point (direction-aware mode).
   */
  avoidedByDirection?: number;
  /** GraphHopper snapped waypoints */
  snappedWaypoints: LngLat[];
}

export type RouteMode =
  /** chosen route passes zero cameras */
  | 'strict'
  /** no zero-camera route exists; chosen route minimises crossings */
  | 'fallback'
  /** balanced single-pass */
  | 'balanced'
  /** strictness=none */
  | 'fastest-only';

export interface RouteResponse {
  mode: RouteMode;
  chosen: RoutePath;
  /** Plain fastest route for comparison (null when it equals chosen, e.g. strictness=none) */
  fastest: RoutePath | null;
  /**
   * Soft/penalized alternative for comparison. Populated in strict-then-fallback
   * mode when a soft path was computed and is not the chosen path; null/undefined
   * when chosen already is the soft path (fallback/balanced) or it wasn't computed.
   */
  soft?: RoutePath | null;
  /** Cameras whose buffer contains origin/destination – cannot be avoided */
  unavoidable: CameraFeature[];
  /** Number of cameras considered in the avoidance geometry */
  camerasConsidered: number;
  bufferM: number;
  /** ms per stage, for debugging */
  timings: Record<string, number>;
  /** Avoid area actually sent to GraphHopper (optional, for map display) */
  avoidArea?: Feature<MultiPolygon | Polygon>;
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export interface GeocodeResult {
  label: string;
  name: string;
  lngLat: LngLat;
  city?: string;
  state?: string;
  country?: string;
  postcode?: string;
  osmId?: number;
  type?: string;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  graphhopper: { ok: boolean; url: string; message?: string; multiPolygonAreasOk?: boolean };
  cameras: CameraStats;
  version: string;
}
