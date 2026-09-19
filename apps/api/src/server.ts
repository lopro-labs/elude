import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { camerasRoutes } from './routes/cameras.js';
import { routeRoutes } from './routes/route.js';
import { geocodeRoutes } from './routes/geocode.js';

export interface ServerOptions {
  logger?: boolean | object;
}

/**
 * Request log serializer that scrubs coordinates and client IPs — this is a
 * privacy tool, so origins/destinations (in `/geocode/reverse?lat=..&lon=..`,
 * `/cameras?bbox=..`) and remoteAddress must never reach the logs. POST bodies
 * (where `/route` carries its coordinates) are not logged by Fastify by default.
 */
const scrubbingLogBase = {
  serializers: {
    req(request: { method?: string; url?: string; headers?: Record<string, unknown> }) {
      const host = request.headers?.host;
      return {
        method: request.method,
        url: (request.url ?? '').split('?')[0],
        host: typeof host === 'string' ? host : undefined,
      };
    },
  },
};

/** Build the Fastify app (without listening) – used by index.ts and tests. */
export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const logger =
    opts.logger === false
      ? false
      : opts.logger === true || opts.logger === undefined
        ? { ...scrubbingLogBase }
        : { ...scrubbingLogBase, ...(opts.logger as object) };

  const app = Fastify({
    logger,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, { origin: config.corsOrigin.length ? config.corsOrigin : true });

  // Per-IP rate limiting. A stricter cap is applied per-route to the expensive
  // route/geocode endpoints via their route `config.rateLimit`.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(camerasRoutes);
      await api.register(routeRoutes);
      await api.register(geocodeRoutes);
    },
    { prefix: '/api' },
  );

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` });
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    reply.code(status).send({
      error: status >= 500 ? 'INTERNAL' : (err.code ?? 'ERROR'),
      message: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  return app;
}
