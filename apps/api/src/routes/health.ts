import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@elude/shared';
import { config } from '../config.js';
import { cameraStore } from '../cameras/store.js';
import { ghHealth, getMultiPolygonSelfTestResult, selfTestMultiPolygon } from '../routing/graphhopper.js';

let selfTestPromise: Promise<boolean> | null = null;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (req): Promise<HealthResponse> => {
    const gh = await ghHealth();
    let mp = getMultiPolygonSelfTestResult();
    if (gh.ok && mp === undefined) {
      // First time GraphHopper is seen healthy: run the MultiPolygon areas self-test once.
      if (!selfTestPromise) {
        selfTestPromise = selfTestMultiPolygon(undefined, (m) => req.log.info(m)).finally(() => {
          selfTestPromise = null;
        });
      }
      mp = await selfTestPromise;
      if (getMultiPolygonSelfTestResult() === undefined) mp = undefined; // network error, retry next time
    }
    const graphhopper: HealthResponse['graphhopper'] = { ok: gh.ok, url: config.ghUrl };
    if (gh.message) graphhopper.message = gh.message;
    if (mp !== undefined) graphhopper.multiPolygonAreasOk = mp;
    const cameras = cameraStore.stats();
    return {
      ok: gh.ok && cameras.count > 0,
      graphhopper,
      cameras,
      version: config.version,
    };
  });
}
