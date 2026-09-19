import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { searchGeocode } from '../geocode/search.js';
import { reverseGeocode } from '../geocode/nominatim.js';

const geocodeRateLimit = { config: { rateLimit: { max: config.rateLimitRouteMax, timeWindow: config.rateLimitWindowMs } } };

const numFromQuery = z.coerce.number().finite();

const geocodeQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  lat: numFromQuery.min(-90).max(90).optional(),
  lon: numFromQuery.min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const reverseQuerySchema = z.object({
  lat: numFromQuery.min(-90).max(90),
  lon: numFromQuery.min(-180).max(180),
});

export async function geocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/geocode', geocodeRateLimit, async (req, reply) => {
    const parsed = geocodeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    try {
      const results = await searchGeocode(parsed.data);
      return reply.header('Cache-Control', 'public, max-age=300').send(results);
    } catch (err) {
      req.log.warn({ err }, 'geocode failed');
      return reply.code(502).send({ error: 'GEOCODER_UNAVAILABLE', message: (err as Error).message });
    }
  });

  app.get('/geocode/reverse', geocodeRateLimit, async (req, reply) => {
    const parsed = reverseQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    try {
      const result = await reverseGeocode(parsed.data.lat, parsed.data.lon);
      return reply.header('Cache-Control', 'public, max-age=600').send(result);
    } catch (err) {
      req.log.warn({ err }, 'reverse geocode failed');
      return reply.code(502).send({ error: 'GEOCODER_UNAVAILABLE', message: (err as Error).message });
    }
  });
}
