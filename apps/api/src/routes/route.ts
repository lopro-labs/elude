import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteRequest } from '@elude/shared';
import { config } from '../config.js';
import { GHUnavailableError, NoRouteError, planRoute } from '../routing/planner.js';
import { GHError } from '../routing/graphhopper.js';

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const avoidZone = z.discriminatedUnion('type', [
  z.object({ type: z.literal('circle'), center: lngLat, radiusM: z.number().min(1).max(50_000) }),
  z.object({ type: z.literal('polygon'), points: z.array(lngLat).min(3).max(200) }),
]);

const surveillanceCategory = z.enum(['alpr', 'speed', 'redlight', 'cctv']);

export const routeRequestSchema = z.object({
  origin: lngLat,
  destination: lngLat,
  waypoints: z.array(lngLat).max(8).optional(),
  avoidZones: z.array(avoidZone).max(20).optional(),
  avoidCategories: z.array(surveillanceCategory).optional(),
  bufferM: z.number().min(1).max(1000).optional(),
  softFactor: z.number().gt(0).max(1).optional(),
  strictness: z.enum(['strict-then-fallback', 'balanced', 'none']).optional(),
  manufacturer: z.string().trim().max(100).optional(),
  directionAware: z.boolean().optional(),
});

export async function routeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/route', { config: { rateLimit: { max: config.rateLimitRouteMax, timeWindow: config.rateLimitWindowMs } } }, async (req, reply) => {
    const parsed = routeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      });
    }
    const body = parsed.data as RouteRequest;
    try {
      const result = await planRoute(body, { log: (m) => req.log.info(m) });
      req.log.info(
        {
          mode: result.mode,
          crossed: result.chosen.camerasCrossed.length,
          camerasConsidered: result.camerasConsidered,
          timings: result.timings,
        },
        'route planned',
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof NoRouteError) {
        return reply.code(422).send({ error: 'NO_ROUTE', message: err.message });
      }
      if (err instanceof GHUnavailableError) {
        req.log.error({ err }, 'GraphHopper unavailable');
        return reply.code(502).send({ error: 'GH_UNAVAILABLE', message: err.message });
      }
      if (err instanceof GHError) {
        const status = err.kind === 'bad_request' ? 400 : 502;
        return reply.code(status).send({ error: err.kind === 'bad_request' ? 'GH_BAD_REQUEST' : 'GH_ERROR', message: err.message });
      }
      throw err;
    }
  });
}
