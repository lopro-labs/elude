import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import type { AvoidZone, CameraFeature, LngLat, SurveillanceCategory } from '@elude/shared';
import { planRoute, GHUnavailableError, NoRouteError } from '../src/routing/planner.js';
import { GHError, type GHPath, type GHRouteParams, type GraphHopperClient } from '../src/routing/graphhopper.js';
import { camera, ghPath, offsetM } from './helpers.js';

const O: LngLat = [-122.42, 37.77];
const D: LngLat = offsetM(O, 5000, 0);
const MID: LngLat = offsetM(O, 2500, 0);

// Cameras: one right on the direct line, one far away (not crossed by any route).
const onLine = camera(offsetM(MID, 0, 5), 'Flock Safety', 100);
const farAway = camera(offsetM(O, 2500, 3000), 'Motorola Solutions', 101);
const allCams = [onLine, farAway];

const direct = ghPath([O, MID, D], { distance: 5000, time: 300_000 });
const detour = ghPath([O, offsetM(O, 1000, 0), offsetM(MID, 0, 800), offsetM(D, -1000, 0), D], { distance: 7000, time: 420_000 });
const softAlt = ghPath([O, offsetM(MID, 0, 400), D], { distance: 6000, time: 360_000 });

type Pass = 'fastest' | 'strict' | 'soft';

function passOf(p: GHRouteParams): Pass {
  const rules = p.customModel?.priority ?? [];
  if (!p.customModel) return 'fastest';
  const block = rules.find((r) => 'else_if' in r);
  return block && Number(block.multiply_by) === 0 ? 'strict' : 'soft';
}

function mockGH(impl: Partial<Record<Pass, GHPath | null | Error>>): GraphHopperClient & { calls: GHRouteParams[] } {
  const calls: GHRouteParams[] = [];
  return {
    calls,
    async route(params) {
      calls.push(params);
      const r = impl[passOf(params)];
      if (r instanceof Error) throw r;
      return r ?? null;
    },
    async health() {
      return { ok: true };
    },
  };
}

const store = (cams: CameraFeature[] = allCams) => ({ query: () => cams });

describe('planRoute', () => {
  it('picks strict over soft over fastest and computes crossings', async () => {
    const gh = mockGH({ fastest: direct, strict: detour, soft: detour });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store() });
    expect(res.mode).toBe('strict');
    expect(res.chosen.kind).toBe('strict');
    expect(res.chosen.points).toEqual(detour.points);
    expect(res.chosen.camerasCrossed).toHaveLength(0);
    expect(res.fastest?.kind).toBe('fastest');
    expect(res.fastest?.camerasCrossed.map((c) => c.id)).toEqual([100]);
    expect(res.camerasConsidered).toBe(2);
    expect(res.bufferM).toBe(30);
    expect(res.unavoidable).toHaveLength(0);
    expect(res.avoidArea?.id).toBe('cams');
    expect(gh.calls).toHaveLength(3);
    // strict pass sends the areas MultiPolygon/Polygon with a block rule
    const strictCall = gh.calls.find((c) => passOf(c) === 'strict')!;
    expect(strictCall.customModel?.areas?.features[0]?.id).toBe('cams');
    expect(strictCall.customModel?.priority?.[0]?.if).toContain('in_cams');
    expect(strictCall.customModel?.priority?.[0]?.if).toContain('BRIDGE');
  });

  it('falls back to soft with mode "fallback" when strict has no route', async () => {
    const gh = mockGH({ fastest: direct, strict: null, soft: detour });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store() });
    expect(res.mode).toBe('fallback');
    expect(res.chosen.kind).toBe('soft');
    expect(res.fastest).not.toBeNull();
  });

  it('uses the fastest route with mode fastest-only when neither avoidance pass finds a route', async () => {
    const gh = mockGH({ fastest: direct, strict: null, soft: null });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store() });
    expect(res.mode).toBe('fastest-only');
    expect(res.chosen.kind).toBe('fastest');
    expect(res.chosen.camerasCrossed.map((c) => c.id)).toEqual([100]);
    expect(res.fastest).toBeNull();
  });

  it('reports unavoidable cameras when the origin is inside a buffer', async () => {
    const atOrigin = camera(offsetM(O, 10, 0), 'Flock Safety', 200);
    const gh = mockGH({ fastest: direct, strict: direct, soft: direct });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store([atOrigin, onLine]) });
    expect(res.unavoidable.map((c) => c.properties.id)).toEqual([200]);
    // strict area excludes the unavoidable camera, so it only contains a single 12-gon
    const strictCall = gh.calls.find((c) => passOf(c) === 'strict')!;
    const geom = strictCall.customModel!.areas!.features[0]!.geometry;
    expect(geom.type).toBe('Polygon');
    // the soft pass includes all cameras
    const softCall = gh.calls.find((c) => passOf(c) === 'soft')!;
    expect(softCall.customModel!.areas!.features[0]!.geometry.type).toBe('MultiPolygon');
  });

  it('strictness=none only asks for the fastest route', async () => {
    const gh = mockGH({ fastest: direct });
    const res = await planRoute({ origin: O, destination: D, strictness: 'none' }, { gh, store: store() });
    expect(gh.calls).toHaveLength(1);
    expect(res.mode).toBe('fastest-only');
    expect(res.fastest).toBeNull();
    expect(res.chosen.kind).toBe('fastest');
    expect(res.chosen.camerasCrossed).toHaveLength(1);
  });

  it('strictness=balanced runs a single soft pass and reports mode balanced', async () => {
    const gh = mockGH({ fastest: direct, soft: detour });
    const res = await planRoute(
      { origin: O, destination: D, strictness: 'balanced', softFactor: 0.1 },
      { gh, store: store() },
    );
    expect(gh.calls).toHaveLength(2);
    expect(res.mode).toBe('balanced');
    expect(res.chosen.kind).toBe('soft');
    const softCall = gh.calls.find((c) => passOf(c) === 'soft')!;
    expect(Number(softCall.customModel!.priority![1]!.multiply_by)).toBeCloseTo(0.1);
  });

  it('clamps bufferM and softFactor', async () => {
    const gh = mockGH({ fastest: direct, strict: direct, soft: direct });
    const res = await planRoute({ origin: O, destination: D, bufferM: 5, softFactor: 5 }, { gh, store: store() });
    expect(res.bufferM).toBe(15);
  });

  it('skips extra GH calls when there are no cameras', async () => {
    const gh = mockGH({ fastest: direct });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store([]) });
    expect(gh.calls).toHaveLength(1);
    expect(res.mode).toBe('strict');
    expect(res.avoidArea).toBeUndefined();
  });

  it('passes waypoints through to every GH pass as [origin, ...waypoints, destination]', async () => {
    const W1: LngLat = offsetM(O, 1000, 500);
    const W2: LngLat = offsetM(O, 3000, -500);
    const gh = mockGH({ fastest: direct, strict: detour, soft: softAlt });
    const res = await planRoute({ origin: O, destination: D, waypoints: [W1, W2] }, { gh, store: store() });
    expect(gh.calls).toHaveLength(3);
    for (const call of gh.calls) expect(call.points).toEqual([O, W1, W2, D]);
    expect(res.mode).toBe('strict');
  });

  it('treats cameras at a waypoint as unavoidable', async () => {
    const W1: LngLat = offsetM(O, 2000, 0);
    const atWaypoint = camera(offsetM(W1, 5, 0), 'Flock Safety', 300);
    const gh = mockGH({ fastest: direct, strict: direct, soft: direct });
    const res = await planRoute(
      { origin: O, destination: D, waypoints: [W1] },
      { gh, store: store([atWaypoint, onLine]) },
    );
    expect(res.unavoidable.map((c) => c.properties.id)).toEqual([300]);
    // strict area excludes the unavoidable camera, so only onLine's 12-gon remains
    const strictCall = gh.calls.find((c) => passOf(c) === 'strict')!;
    expect(strictCall.customModel!.areas!.features[0]!.geometry.type).toBe('Polygon');
  });

  it('exposes the soft alternative in strict mode, but not when soft is chosen', async () => {
    const gh = mockGH({ fastest: direct, strict: detour, soft: softAlt });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store() });
    expect(res.mode).toBe('strict');
    expect(res.soft?.kind).toBe('soft');
    expect(res.soft?.points).toEqual(softAlt.points);
    expect(res.soft?.camerasCrossed).toBeDefined();

    const gh2 = mockGH({ fastest: direct, strict: null, soft: detour });
    const res2 = await planRoute({ origin: O, destination: D }, { gh: gh2, store: store() });
    expect(res2.mode).toBe('fallback');
    expect(res2.chosen.kind).toBe('soft');
    expect(res2.soft ?? null).toBeNull();

    const gh3 = mockGH({ fastest: direct, soft: detour });
    const res3 = await planRoute({ origin: O, destination: D, strictness: 'balanced' }, { gh: gh3, store: store() });
    expect(res3.soft ?? null).toBeNull();
  });

  it('counts cameras avoided by direction and drops them from camerasCrossed', async () => {
    // 20 m north of the direct line, facing north (away from the road)
    const behindCam = camera(offsetM(MID, 0, 20), 'Flock Safety', 400, 0);
    const gh = mockGH({ fastest: direct, strict: direct, soft: direct });
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store([behindCam]) });
    expect(res.chosen.camerasCrossed).toHaveLength(0);
    expect(res.chosen.avoidedByDirection).toBe(1);

    const gh2 = mockGH({ fastest: direct, strict: direct, soft: direct });
    const off = await planRoute(
      { origin: O, destination: D, directionAware: false },
      { gh: gh2, store: store([behindCam]) },
    );
    expect(off.chosen.camerasCrossed.map((c) => c.id)).toEqual([400]);
    expect(off.chosen.avoidedByDirection).toBe(0);
  });

  it('throws NoRouteError when even the fastest route fails', async () => {
    const gh = mockGH({ fastest: null, strict: null, soft: null });
    await expect(planRoute({ origin: O, destination: D }, { gh, store: store() })).rejects.toBeInstanceOf(NoRouteError);
  });

  it('throws GHUnavailableError when GraphHopper is unreachable', async () => {
    const err = new GHError('connect ECONNREFUSED', 502, 'unreachable');
    const gh = mockGH({ fastest: err, strict: err, soft: err });
    await expect(planRoute({ origin: O, destination: D }, { gh, store: store() })).rejects.toBeInstanceOf(
      GHUnavailableError,
    );
  });

  it('widens the avoidance corridor when a strict result crosses a camera outside it', async () => {
    // A camera 5 km off the direct line is outside the initial corridor (3 km). A "strict" route
    // computed without it would happily cross it; the planner must notice and re-run with it.
    const farDetourCam = camera(offsetM(MID, 0, 5000), 'Flock Safety', 102);
    const throughFarCam = ghPath([O, offsetM(MID, 0, 5000), D], { distance: 12_000, time: 700_000 });
    const cleanDetour = ghPath([O, offsetM(MID, 0, 7000), D], { distance: 15_000, time: 900_000 });
    const calls: GHRouteParams[] = [];
    const gh: GraphHopperClient = {
      async route(p) {
        calls.push(p);
        if (passOf(p) !== 'strict') return passOf(p) === 'fastest' ? direct : softAlt;
        const polys = p.customModel?.areas?.features.find((f) => f.id === 'cams')?.geometry;
        const n = polys?.type === 'MultiPolygon' ? polys.coordinates.length : polys ? 1 : 0;
        // Only the on-line camera in the area → GH would route through the far camera.
        return n <= 1 ? throughFarCam : cleanDetour;
      },
      async health() {
        return { ok: true };
      },
    };
    const res = await planRoute({ origin: O, destination: D }, { gh, store: store([onLine, farDetourCam]) });
    expect(res.mode).toBe('strict');
    expect(res.chosen.points).toEqual(cleanDetour.points);
    expect(res.chosen.camerasCrossed).toHaveLength(0);
    const strictCalls = calls.filter((p) => passOf(p) === 'strict');
    expect(strictCalls).toHaveLength(2);
  });
});

const zonesRule = (p: GHRouteParams) => (p.customModel?.priority ?? []).find((r) => r.if === 'in_zones');
const areaIds = (p: GHRouteParams) => (p.customModel?.areas?.features ?? []).map((f) => f.id);

describe('planRoute – user-drawn avoid zones', () => {
  const zone: AvoidZone = { type: 'circle', center: MID, radiusM: 100 };

  it('hard-avoids zones in the strict pass (alongside the camera area)', async () => {
    const gh = mockGH({ fastest: direct, strict: detour, soft: softAlt });
    const res = await planRoute({ origin: O, destination: D, avoidZones: [zone] }, { gh, store: store() });
    expect(res.mode).toBe('strict');
    const strictCall = gh.calls.find((c) => passOf(c) === 'strict')!;
    expect(areaIds(strictCall)).toContain('cams');
    expect(areaIds(strictCall)).toContain('zones');
    const zr = zonesRule(strictCall)!;
    expect(zr).toBeDefined();
    expect(Number(zr.multiply_by)).toBe(0);
    // avoidArea returned to the map stays camera-only
    expect(res.avoidArea?.id).toBe('cams');
  });

  it('hard-avoids zones in the balanced (soft) pass', async () => {
    const gh = mockGH({ fastest: direct, soft: detour });
    const res = await planRoute(
      { origin: O, destination: D, strictness: 'balanced', avoidZones: [zone] },
      { gh, store: store() },
    );
    expect(res.mode).toBe('balanced');
    const softCall = gh.calls.find((c) => passOf(c) === 'soft')!;
    expect(areaIds(softCall)).toContain('cams');
    expect(areaIds(softCall)).toContain('zones');
    expect(Number(zonesRule(softCall)!.multiply_by)).toBe(0);
  });

  it('runs a zones-only pass in strictness=none and makes it the chosen route', async () => {
    const calls: GHRouteParams[] = [];
    const gh: GraphHopperClient & { calls: GHRouteParams[] } = {
      calls,
      async route(p) {
        calls.push(p);
        return p.customModel ? detour : direct; // zones-only pass -> detour; pure fastest -> direct
      },
      async health() {
        return { ok: true };
      },
    };
    const res = await planRoute(
      { origin: O, destination: D, strictness: 'none', avoidZones: [zone] },
      { gh, store: store() },
    );
    expect(calls).toHaveLength(2);
    expect(res.mode).toBe('fastest-only');
    expect(res.chosen.kind).toBe('fastest');
    expect(res.chosen.points).toEqual(detour.points); // the zone-avoiding path is chosen
    expect(res.fastest?.points).toEqual(direct.points); // pure fastest kept for comparison
    const zonesCall = calls.find((c) => c.customModel)!;
    expect(areaIds(zonesCall)).toEqual(['zones']); // ONLY the zones area, no cameras
    expect(Number(zonesRule(zonesCall)!.multiply_by)).toBe(0);
  });

  it('strictness=none without zones is unchanged (single fastest pass, no comparison)', async () => {
    const gh = mockGH({ fastest: direct });
    const res = await planRoute({ origin: O, destination: D, strictness: 'none' }, { gh, store: store() });
    expect(gh.calls).toHaveLength(1);
    expect(res.fastest).toBeNull();
  });
});

describe('planRoute – avoidCategories', () => {
  it('does not call getSurveillance for the default alpr-only request', async () => {
    let called = 0;
    const gh = mockGH({ fastest: direct, strict: detour, soft: detour });
    await planRoute(
      { origin: O, destination: D },
      {
        gh,
        store: store(),
        getSurveillance: async () => {
          called++;
          return [];
        },
      },
    );
    expect(called).toBe(0);
  });

  it('fetches extra categories and folds their features into the avoid geometry', async () => {
    const speedCam = camera(offsetM(MID, 0, 8), 'n/a', 900);
    speedCam.properties.category = 'speed';
    const requested: SurveillanceCategory[][] = [];
    const gh = mockGH({ fastest: direct, strict: detour, soft: softAlt });
    const res = await planRoute(
      { origin: O, destination: D, avoidCategories: ['alpr', 'speed'] },
      {
        gh,
        store: store(),
        getSurveillance: async (_bbox, cats) => {
          requested.push(cats);
          return [speedCam];
        },
      },
    );
    // getSurveillance is called with only the extra (non-alpr) categories
    expect(requested).toContainEqual(['speed']);
    // 2 alpr from the store + 1 speed camera
    expect(res.camerasConsidered).toBe(3);
    // the speed camera actually reaches the camera avoid area
    const strictCall = gh.calls.find((c) => passOf(c) === 'strict')!;
    const cams = strictCall.customModel!.areas!.features.find((f) => f.id === 'cams')!;
    expect(turf.booleanPointInPolygon(speedCam.geometry.coordinates as LngLat, cams.geometry)).toBe(true);
  });
});
