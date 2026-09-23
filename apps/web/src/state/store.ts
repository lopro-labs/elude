import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AvoidZone, CameraStats, HealthResponse, LngLat, RouteKind, RoutePath, RouteResponse, Strictness, SurveillanceCategory } from '@elude/shared';
import { shortCoord, type Units } from '../util/format';

export const SURVEILLANCE_CATEGORIES: SurveillanceCategory[] = ['alpr', 'speed', 'redlight', 'cctv'];
export const CATEGORY_META: Record<SurveillanceCategory, { label: string; short: string; color: string }> = {
  alpr: { label: 'ALPR / plate readers', short: 'ALPR', color: '#ff5a5f' },
  speed: { label: 'Speed cameras', short: 'Speed', color: '#ffb020' },
  redlight: { label: 'Red-light cameras', short: 'Red-light', color: '#b57cff' },
  cctv: { label: 'Other CCTV', short: 'CCTV', color: '#4aa3ff' },
};

export interface Place {
  lngLat: LngLat;
  label: string;
}

export type ManufacturerFilter = 'all' | 'flock' | 'custom';

export interface Settings {
  bufferM: number;
  /** 0 (weak) … 1 (strong). Mapped to softFactor 0.2 … 0.005. */
  avoidance: number;
  strictness: Strictness;
  manufacturerFilter: ManufacturerFilter;
  manufacturerCustom: string;
  units: Units;
  showAvoidArea: boolean;
  showCameras: boolean;
  showFastest: boolean;
  voice: boolean;
  /** Only avoid directional cameras where they can actually see the road you're on. */
  directionAware: boolean;
  /** Which surveillance categories to render on the map. ALPR is always shown. */
  surveillanceShow: Record<SurveillanceCategory, boolean>;
  /** Which categories to route around (fed to the API as avoidCategories). */
  surveillanceAvoid: Record<SurveillanceCategory, boolean>;
  /** Show the per-stage route timings line (also ?debug / localStorage elude:debug). */
  showDiagnostics: boolean;
  /** Warn (HUD + voice + vibration) when approaching / passing a camera while navigating. */
  cameraAlerts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  bufferM: 30,
  avoidance: 0.7,
  strictness: 'strict-then-fallback',
  manufacturerFilter: 'all',
  manufacturerCustom: '',
  units: 'imperial',
  showAvoidArea: false,
  showCameras: true,
  showFastest: true,
  voice: true,
  directionAware: true,
  surveillanceShow: { alpr: true, speed: false, redlight: false, cctv: false },
  surveillanceAvoid: { alpr: true, speed: false, redlight: false, cctv: false },
  showDiagnostics: false,
  cameraAlerts: true,
};

/** Categories currently toggled on for display / avoidance, as an array. */
export function activeCategories(rec: Record<SurveillanceCategory, boolean>): SurveillanceCategory[] {
  return SURVEILLANCE_CATEGORIES.filter((c) => rec[c]);
}

/** Map the 0..1 avoidance slider onto GraphHopper's priority factor (log scale). */
export function avoidanceToSoftFactor(a: number): number {
  const strong = 0.005;
  const weak = 0.2;
  const t = Math.min(1, Math.max(0, a));
  // log interpolation: t=0 → weak, t=1 → strong
  return Number(Math.exp(Math.log(weak) + (Math.log(strong) - Math.log(weak)) * t).toPrecision(3));
}

export function manufacturerParam(s: Settings): string | undefined {
  if (s.manufacturerFilter === 'flock') return 'Flock';
  if (s.manufacturerFilter === 'custom') return s.manufacturerCustom.trim() || undefined;
  return undefined;
}

export type PointRole = 'origin' | 'destination';
/** Where the next map click / search result lands: an endpoint or stop index. */
export type InputTarget = PointRole | { stop: number };

export function isStopTarget(t: InputTarget | null | undefined): t is { stop: number } {
  return typeof t === 'object' && t != null;
}

export function sameTarget(a: InputTarget | null, b: InputTarget | null): boolean {
  if (a === b) return true;
  if (isStopTarget(a) && isStopTarget(b)) return a.stop === b.stop;
  return false;
}

/** The path currently shown/navigated: server's choice, or the user's comparison-card pick. */
export function activePath(route: RouteResponse | null, selectedKind: RouteKind | null): RoutePath | null {
  if (!route) return null;
  if (!selectedKind || route.chosen.kind === selectedKind) return route.chosen;
  if (selectedKind === 'fastest' && route.fastest) return route.fastest;
  if (selectedKind === 'soft' && route.soft) return route.soft;
  return route.chosen;
}

export interface MapCommand {
  id: number;
  type: 'fit-route' | 'fly-to' | 'fly-user';
  lngLat?: LngLat;
  zoom?: number;
}

/** Avoid-zone drawing interaction. */
export type DrawMode = 'off' | 'circle' | 'polygon';
export interface DrawState {
  mode: DrawMode;
  /** Circle: [center] once placed. Polygon: vertices so far. */
  points: LngLat[];
  /** Live cursor position for the rubber-band preview. */
  cursor: LngLat | null;
}
export const INITIAL_DRAW: DrawState = { mode: 'off', points: [], cursor: null };

let zoneId = 0;
export interface StoredZone {
  id: string;
  zone: AvoidZone;
}
export function makeZone(zone: AvoidZone): StoredZone {
  return { id: `z${++zoneId}`, zone };
}

/** Metres between two lng/lat points (haversine); inlined to keep the store dependency-light. */
export function haversineMeters([lon1, lat1]: LngLat, [lon2, lat2]: LngLat): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface NavState {
  active: boolean;
  simulate: boolean;
  /** raw or simulated GPS fix */
  position: LngLat | null;
  heading: number | null;
  speedMps: number | null;
  /** position snapped to the route */
  snapped: LngLat | null;
  snappedIndex: number;
  alongM: number;
  stepIndex: number;
  /** metres to the next maneuver */
  distToManeuverM: number;
  remainingM: number;
  remainingMs: number;
  offRoute: boolean;
  rerouting: boolean;
  arrived: boolean;
  follow: boolean;
  gpsError: string | null;
  cameraAlert: CameraAlert | null;
  /** Watch mode: GPS tracking without a route; alerts against nearby cameras. */
  watch: boolean;
  /** Watch mode: cameras within WATCH_NEARBY_M of the last fix. */
  nearbyCount: number;
}

export const INITIAL_NAV: NavState = {
  active: false,
  simulate: false,
  position: null,
  heading: null,
  speedMps: null,
  snapped: null,
  snappedIndex: 0,
  alongM: 0,
  stepIndex: 0,
  distToManeuverM: 0,
  remainingM: 0,
  remainingMs: 0,
  offRoute: false,
  rerouting: false,
  arrived: false,
  follow: true,
  gpsError: null,
  cameraAlert: null,
  watch: false,
  nearbyCount: 0,
};

export type CameraAlertPhase = 'approaching' | 'passing';
export interface CameraAlert {
  cameraId: number;
  phase: CameraAlertPhase;
  /** metres from the fix to the camera's crossing point (0 when passing) */
  distanceM: number;
  manufacturer?: string;
  possiblyNotVisible: boolean;
  /** Directional camera pointed away from the fix (watch mode) — informational, no vibration */
  facingAway?: boolean;
  /** Date.now() when raised; HUD hides it ALERT_TTL_MS after */
  at: number;
}
export interface TripPass {
  /** ISO wall-clock time of the pass */
  at: string;
  cameraId: number;
  osmType: 'node' | 'way' | 'relation';
  lngLat: LngLat;
  manufacturer?: string;
  operator?: string;
  direction?: number;
  /** camera-to-road distance, metres (from CrossedCamera.distanceM) */
  distanceM: number;
  possiblyNotVisible: boolean;
  facingAway?: boolean;
  /** US state of the pass, resolved lazily (reverse geocode) for the records request. */
  state?: string;
  /** metres into the drive */
  alongM: number;
}
export type TripMode = 'route' | 'simulate' | 'watch';
export interface TripDraft {
  startedAt: string;
  mode: TripMode;
  passes: TripPass[];
  /** Watch mode: first/last GPS fix and distance travelled between fixes. */
  firstFix: LngLat | null;
  lastFix: LngLat | null;
  travelledM: number;
}
export interface Trip {
  id: string;
  startedAt: string;
  endedAt: string;
  mode: TripMode;
  originLabel: string;
  destinationLabel: string;
  /** Watch mode: first / last GPS fix (labels above are geocoded from these). */
  from?: LngLat;
  to?: LngLat;
  /** planned path distance, metres */
  distanceM: number;
  passes: TripPass[];
}
export const MAX_TRIPS = 50;

interface AppState {
  origin: Place | null;
  destination: Place | null;
  /** Intermediate stops, in order. null = empty row awaiting input. */
  stops: (Place | null)[];
  /** which input receives the next map click */
  activeInput: InputTarget | null;
  setPlace: (role: PointRole, place: Place | null) => void;
  setStop: (index: number, place: Place | null) => void;
  setStops: (stops: (Place | null)[]) => void;
  addStop: () => void;
  removeStop: (index: number) => void;
  moveStop: (from: number, to: number) => void;
  swapPlaces: () => void;
  setActiveInput: (target: InputTarget | null) => void;

  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;

  route: RouteResponse | null;
  routeLoading: boolean;
  routeError: string | null;
  setRoute: (route: RouteResponse | null) => void;
  setRouteLoading: (v: boolean) => void;
  setRouteError: (msg: string | null) => void;

  /** Comparison-card pick; null = the server's chosen path. */
  selectedKind: RouteKind | null;
  setSelectedKind: (k: RouteKind | null) => void;

  /** index of the highlighted turn-by-turn step */
  highlightedStep: number | null;
  setHighlightedStep: (i: number | null) => void;

  /** User-drawn avoid zones. */
  zones: StoredZone[];
  addZone: (zone: AvoidZone) => void;
  removeZone: (id: string) => void;
  clearZones: () => void;
  draw: DrawState;
  setDrawMode: (mode: DrawMode) => void;
  pushDrawPoint: (p: LngLat) => void;
  setDrawCursor: (p: LngLat | null) => void;
  cancelDraw: () => void;

  mapCommand: MapCommand | null;
  sendMapCommand: (cmd: Omit<MapCommand, 'id'>) => void;

  userLocation: LngLat | null;
  setUserLocation: (p: LngLat | null) => void;

  health: HealthResponse | null;
  healthError: boolean;
  setHealth: (h: HealthResponse | null, error: boolean) => void;
  stats: CameraStats | null;
  setStats: (s: CameraStats | null) => void;

  camerasInView: number;
  setCamerasInView: (n: number) => void;
  /** Current map viewport centre — geocoding bias when there is no user location / origin. */
  mapCenter: LngLat | null;
  setMapCenter: (p: LngLat) => void;

  nav: NavState;
  updateNav: (patch: Partial<NavState>) => void;
  startNav: (simulate: boolean) => void;
  /** Route-less GPS watch: alerts against nearby cameras, logs passes. */
  startWatch: () => void;
  stopNav: () => void;
  /** Passes recorded during the current drive (null when not navigating). */
  tripDraft: TripDraft | null;
  recordPass: (pass: TripPass) => void;
  /** Watch mode: track first/last fix and distance travelled for the trip record. */
  recordWatchFix: (lngLat: LngLat) => void;
  relabelTrip: (id: string, patch: Pick<Partial<Trip>, 'originLabel' | 'destinationLabel'>) => void;
  /** Saved drives, newest first. Persisted. */
  trips: Trip[];
  deleteTrip: (id: string) => void;
  clearTrips: () => void;
  /** Persist resolved states for passes of a trip (cameraId -> state). */
  setTripPassStates: (tripId: string, states: Record<number, string>) => void;

  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
}

let cmdId = 0;

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      origin: null,
      destination: null,
      stops: [],
      activeInput: null,
      setPlace: (role, place) => set(role === 'origin' ? { origin: place } : { destination: place }),
      setStop: (index, place) => set((s) => ({ stops: s.stops.map((p, i) => (i === index ? place : p)) })),
      setStops: (stops) => set({ stops: stops.slice(0, 8) }),
      addStop: () => set((s) => (s.stops.length >= 8 ? s : { stops: [...s.stops, null], activeInput: { stop: s.stops.length } })),
      removeStop: (index) =>
        set((s) => ({
          stops: s.stops.filter((_, i) => i !== index),
          activeInput: isStopTarget(s.activeInput) && s.activeInput.stop === index ? null : s.activeInput,
        })),
      moveStop: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || to < 0 || from >= s.stops.length || to >= s.stops.length) return s;
          const stops = [...s.stops];
          const [moved] = stops.splice(from, 1);
          stops.splice(to, 0, moved);
          return { stops };
        }),
      swapPlaces: () => set((s) => ({ origin: s.destination, destination: s.origin, stops: [...s.stops].reverse() })),
      setActiveInput: (target) => set({ activeInput: target }),

      settings: DEFAULT_SETTINGS,
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      route: null,
      routeLoading: false,
      routeError: null,
      setRoute: (route) =>
        set((s) => ({
          route,
          highlightedStep: null,
          // Keep the user's comparison pick across re-routes when the new response still has that path.
          selectedKind: route && s.selectedKind && activePath(route, s.selectedKind)?.kind === s.selectedKind ? s.selectedKind : null,
        })),
      setRouteLoading: (v) => set({ routeLoading: v }),
      setRouteError: (msg) => set({ routeError: msg }),

      selectedKind: null,
      setSelectedKind: (k) => set({ selectedKind: k, highlightedStep: null }),

      highlightedStep: null,
      setHighlightedStep: (i) => set({ highlightedStep: i }),

      zones: [],
      addZone: (zone) => set((s) => ({ zones: [...s.zones, makeZone(zone)] })),
      removeZone: (id) => set((s) => ({ zones: s.zones.filter((z) => z.id !== id) })),
      clearZones: () => set({ zones: [] }),
      draw: INITIAL_DRAW,
      setDrawMode: (mode) => set({ draw: { mode, points: [], cursor: null }, activeInput: null }),
      pushDrawPoint: (p) =>
        set((s) => {
          if (s.draw.mode === 'circle') {
            // First click = center; second click = radius edge → commit the circle.
            if (s.draw.points.length === 0) return { draw: { ...s.draw, points: [p] } };
            const center = s.draw.points[0];
            const radiusM = haversineMeters(center, p);
            if (radiusM < 5) return s; // ignore a degenerate tap
            return { zones: [...s.zones, makeZone({ type: 'circle', center, radiusM })], draw: INITIAL_DRAW };
          }
          if (s.draw.mode === 'polygon') return { draw: { ...s.draw, points: [...s.draw.points, p] } };
          return s;
        }),
      setDrawCursor: (p) => set((s) => (s.draw.mode === 'off' ? s : { draw: { ...s.draw, cursor: p } })),
      cancelDraw: () => set({ draw: INITIAL_DRAW }),

      mapCommand: null,
      sendMapCommand: (cmd) => set({ mapCommand: { ...cmd, id: ++cmdId } }),

      userLocation: null,
      setUserLocation: (p) => set({ userLocation: p }),

      health: null,
      healthError: false,
      setHealth: (h, error) => set({ health: h, healthError: error }),
      stats: null,
      setStats: (s) => set({ stats: s }),

      camerasInView: 0,
      setCamerasInView: (n) => set({ camerasInView: n }),
      mapCenter: null,
      setMapCenter: (p) => set({ mapCenter: p }),

      nav: INITIAL_NAV,
      updateNav: (patch) => set((s) => ({ nav: { ...s.nav, ...patch } })),
      startNav: (simulate) => {
        if (!get().route) return;
        set({
          nav: { ...INITIAL_NAV, active: true, simulate, follow: true },
          panelOpen: false,
          settingsOpen: false,
          tripDraft: { startedAt: new Date().toISOString(), mode: simulate ? 'simulate' : 'route', passes: [], firstFix: null, lastFix: null, travelledM: 0 },
        });
      },
      startWatch: () =>
        set({
          nav: { ...INITIAL_NAV, active: true, watch: true, follow: true },
          panelOpen: false,
          settingsOpen: false,
          tripDraft: { startedAt: new Date().toISOString(), mode: 'watch', passes: [], firstFix: null, lastFix: null, travelledM: 0 },
        }),
      stopNav: () =>
        set((s) => {
          const d = s.tripDraft;
          const path = activePath(s.route, s.selectedKind);
          const watch = d?.mode === 'watch';
          const trips =
            d && d.passes.length > 0
              ? [
                  {
                    id: `t${Date.now().toString(36)}`,
                    startedAt: d.startedAt,
                    endedAt: new Date().toISOString(),
                    mode: d.mode,
                    originLabel: watch ? (d.firstFix ? shortCoord(d.firstFix) : '') : (s.origin?.label ?? ''),
                    destinationLabel: watch ? (d.lastFix ? shortCoord(d.lastFix) : '') : (s.destination?.label ?? ''),
                    distanceM: watch ? Math.round(d.travelledM) : (path?.distance ?? 0),
                    ...(watch && d.firstFix && d.lastFix ? { from: d.firstFix, to: d.lastFix } : {}),
                    passes: d.passes,
                  },
                  ...s.trips,
                ].slice(0, MAX_TRIPS)
              : s.trips;
          return { nav: INITIAL_NAV, panelOpen: true, tripDraft: null, trips };
        }),

      tripDraft: null,
      recordPass: (pass) =>
        set((s) =>
          s.tripDraft && !s.tripDraft.passes.some((p) => p.cameraId === pass.cameraId)
            ? { tripDraft: { ...s.tripDraft, passes: [...s.tripDraft.passes, pass] } }
            : s,
        ),
      recordWatchFix: (lngLat) =>
        set((s) => {
          const d = s.tripDraft;
          if (!d) return s;
          const step = d.lastFix ? haversineMeters(d.lastFix, lngLat) : 0;
          // Ignore sub-5 m jitter so a parked car does not accumulate distance.
          if (d.lastFix && step < 5) return s;
          return { tripDraft: { ...d, firstFix: d.firstFix ?? lngLat, lastFix: lngLat, travelledM: d.travelledM + step } };
        }),
      relabelTrip: (id, patch) => set((s) => ({ trips: s.trips.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      trips: [],
      deleteTrip: (id) => set((s) => ({ trips: s.trips.filter((t) => t.id !== id) })),
      clearTrips: () => set({ trips: [] }),
      setTripPassStates: (tripId, states) =>
        set((s) => ({
          trips: s.trips.map((t) =>
            t.id === tripId ? { ...t, passes: t.passes.map((p) => (states[p.cameraId] ? { ...p, state: states[p.cameraId] } : p)) } : t,
          ),
        })),

      panelOpen: true,
      setPanelOpen: (v) => set({ panelOpen: v }),
      settingsOpen: false,
      setSettingsOpen: (v) => set({ settingsOpen: v }),
    }),
    {
      name: 'elude:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings, origin: s.origin, destination: s.destination, stops: s.stops.filter(Boolean), zones: s.zones, trips: s.trips }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
        // Records added in later versions must be complete, not partially-merged from an old snapshot.
        settings.surveillanceShow = { ...DEFAULT_SETTINGS.surveillanceShow, ...(p.settings?.surveillanceShow ?? {}) };
        settings.surveillanceAvoid = { ...DEFAULT_SETTINGS.surveillanceAvoid, ...(p.settings?.surveillanceAvoid ?? {}) };
        // Trips saved before `mode` existed carried a `simulated` flag.
        const trips: Trip[] = (p.trips ?? []).map((t) => (t.mode ? t : { ...t, mode: 'simulated' in t && t.simulated ? 'simulate' : 'route' }));
        return { ...current, ...p, stops: (p.stops ?? []).filter(Boolean), zones: p.zones ?? [], trips, settings };
      },
    },
  ),
);

/** Convenience selectors */
export const selectHasBothPoints = (s: AppState) => Boolean(s.origin && s.destination);
export const selectActivePath = (s: AppState) => activePath(s.route, s.selectedKind);
