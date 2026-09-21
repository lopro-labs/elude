import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LngLat } from '@elude/shared';
import { buildServer } from '../src/server.js';
import { cameraStore } from '../src/cameras/store.js';
import { GHError, setGraphHopperClient, type GHRouteParams } from '../src/routing/graphhopper.js';
import { camera, ghPath, offsetM } from './helpers.js';

const O: LngLat = [-122.42, 37.77];
const D: LngLat = offsetM(O, 5000, 0);

let app: FastifyInstance;

beforeAll(async () => {
  cameraStore.setFeatures([camera(offsetM(O, 2500, 5), 'Flock Safety', 1), camera(offsetM(O, 0, 3000), 'Motorola', 2)], 'cache', '2026-01-01T00:00:00Z');
  app = await buildServer({ logger: false });
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('reports GraphHopper down without failing', async () => {
    setGraphHopperClient({
      async route() {
        throw new GHError('down', 502, 'unreachable');
      },
      async health() {
        return { ok: false, message: 'ECONNREFUSED' };
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.graphhopper.ok).toBe(false);
    expect(body.graphhopper.message).toBe('ECONNREFUSED');
    expect(body.cameras.count).toBe(2);
    expect(body.cameras.source).toBe('cache');
    expect(body.version).toBeTypeOf('string');
  });
});

describe('GET /api/cameras', () => {
  it('validates bbox', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cameras?bbox=1,2,3' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('returns a FeatureCollection filtered by bbox and manufacturer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cameras?bbox=-122.5,37.7,-122.3,37.9' });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe('FeatureCollection');
    expect(res.json().features).toHaveLength(2);
    const flock = await app.inject({ method: 'GET', url: '/api/cameras?bbox=-122.5,37.7,-122.3,37.9&manufacturer=flock' });
    expect(flock.json().features).toHaveLength(1);
    expect(flock.json().features[0].properties.id).toBe(1);
  });

  it('serves stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cameras/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);
    expect(res.json().manufacturers['Flock Safety']).toBe(1);
  });

  it('treats categories=alpr like the default (in-memory store, manufacturer filter)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cameras?bbox=-122.5,37.7,-122.3,37.9&categories=alpr' });
    expect(res.statusCode).toBe(200);
    expect(res.json().features).toHaveLength(2);
    const flock = await app.inject({
      method: 'GET',
      url: '/api/cameras?bbox=-122.5,37.7,-122.3,37.9&categories=alpr&manufacturer=flock',
    });
    expect(flock.json().features).toHaveLength(1);
  });

  it('rejects an unknown category', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cameras?bbox=-122.5,37.7,-122.3,37.9&categories=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });
});

describe('POST /api/route', () => {
  it('rejects invalid bodies', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/route', payload: { origin: [1] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('returns 502 when GraphHopper is unreachable', async () => {
    setGraphHopperClient({
      async route() {
        throw new GHError('connect ECONNREFUSED', 502, 'unreachable');
      },
      async health() {
        return { ok: false };
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/route', payload: { origin: O, destination: D } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('GH_UNAVAILABLE');
  });

  it('returns 422 NO_ROUTE when nothing routes', async () => {
    setGraphHopperClient({
      async route() {
        return null;
      },
      async health() {
        return { ok: true };
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/route', payload: { origin: O, destination: D } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('NO_ROUTE');
  });

  it('returns a RouteResponse', async () => {
    const calls: GHRouteParams[] = [];
    setGraphHopperClient({
      async route(p) {
        calls.push(p);
        return ghPath([O, offsetM(O, 2500, 0), D]);
      },
      async health() {
        return { ok: true };
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/route', payload: { origin: O, destination: D, bufferM: 40 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('strict');
    expect(body.chosen.kind).toBe('strict');
    expect(body.chosen.camerasCrossed).toHaveLength(1);
    expect(body.bufferM).toBe(40);
    expect(body.camerasConsidered).toBe(2);
    expect(body.avoidArea.id).toBe('cams');
    // fastest + soft + strict (corridor set) + one strict widening to the full set, because the
    // fake GH keeps returning a camera-crossing path so the corridor result fails verification.
    expect(calls.length).toBe(4);
  });
});

describe('404', () => {
  it('returns JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });
});
