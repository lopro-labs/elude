import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BBox, CameraCollection, CameraFeature, CameraStats, SurveillanceCategory } from '@elude/shared';
import { cameraStore } from '../cameras/store.js';
import { getSurveillance } from '../cameras/surveillance.js';

export const MAX_CAMERA_FEATURES = 20_000;

const VALID_CATEGORIES: SurveillanceCategory[] = ['alpr', 'speed', 'redlight', 'cctv'];

const bboxSchema = z
  .string()
  .transform((s, ctx) => {
    const parts = s.split(',').map((x) => Number(x.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox must be "west,south,east,north"' });
      return z.NEVER;
    }
    const [w, s0, e, n] = parts as [number, number, number, number];
    if (w < -180 || e > 180 || s0 < -90 || n > 90 || w > e || s0 > n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox out of range or inverted' });
      return z.NEVER;
    }
    return [w, s0, e, n] as BBox;
  });

const categoriesSchema = z
  .string()
  .transform((s, ctx) => {
    const parts = s
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return ['alpr'] as SurveillanceCategory[];
    for (const p of parts) {
      if (!VALID_CATEGORIES.includes(p as SurveillanceCategory)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown category "${p}"` });
        return z.NEVER;
      }
    }
    return [...new Set(parts)] as SurveillanceCategory[];
  })
  .optional();

const camerasQuerySchema = z.object({
  bbox: bboxSchema,
  manufacturer: z.string().trim().min(1).max(100).optional(),
  categories: categoriesSchema,
});

export async function camerasRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cameras', async (req, reply) => {
    const parsed = camerasQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    const { bbox, manufacturer } = parsed.data;
    const categories = parsed.data.categories ?? (['alpr'] as SurveillanceCategory[]);
    const extras = categories.filter((c) => c !== 'alpr');

    // ALPR from the in-memory store (only ALPR supports the manufacturer filter).
    const features: CameraFeature[] = categories.includes('alpr') ? [...cameraStore.query(bbox, manufacturer)] : [];
    if (extras.length > 0) {
      const seen = new Set(features.map((f) => String(f.id)));
      const extraFeatures = await getSurveillance(bbox, extras, (m) => req.log.info(m));
      for (const f of extraFeatures) {
        const key = String(f.id);
        if (!seen.has(key)) {
          seen.add(key);
          features.push(f);
        }
      }
    }

    if (features.length > MAX_CAMERA_FEATURES) {
      return reply.code(413).send({
        error: 'BBOX_TOO_LARGE',
        message: `bbox contains ${features.length} cameras (max ${MAX_CAMERA_FEATURES}); zoom in`,
        count: features.length,
      });
    }
    const body: CameraCollection = { type: 'FeatureCollection', features };
    return reply.header('Cache-Control', 'public, max-age=60').send(body);
  });

  app.get('/cameras/stats', async (): Promise<CameraStats> => cameraStore.stats());
}
