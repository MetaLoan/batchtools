import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { hasCapability } from '../providers/index.js';
import {
  cancelJob,
  createJob,
  getJob,
  listJobs,
  listSubJobs,
  retrySubJob,
} from '../services/job-service.js';

const MediaInputSchema = z.object({
  kind: z.enum([
    'first_frame',
    'last_frame',
    'first_clip',
    'reference_image',
    'reference_video',
    'reference_voice',
    'driving_audio',
  ]),
  url: z.string().min(1),
  localId: z.string().optional(),
  boundTo: z.string().optional(),
  meta: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      durationSec: z.number().optional(),
      mime: z.string().optional(),
      bytes: z.number().optional(),
    })
    .optional(),
});

const BatchAxisValue = z.object({
  label: z.string(),
  paramOverrides: z.record(z.unknown()).optional(),
  promptOverride: z.string().optional(),
  mediaOverride: z.array(MediaInputSchema).optional(),
});

const CreateJobBody = z.object({
  accountId: z.string().min(1),
  capabilityId: z.string().min(1),
  modelVariant: z.string().min(1),
  basePrompt: z.string().optional(),
  baseNegativePrompt: z.string().optional(),
  baseMedia: z.array(MediaInputSchema).default([]),
  baseParameters: z.record(z.unknown()).default({}),
  batchMatrix: z
    .object({
      axes: z.array(z.object({ name: z.string(), values: z.array(BatchAxisValue) })).default([]),
      overrides: z
        .record(
          z.string(),
          z.object({
            paramOverrides: z.record(z.unknown()).optional(),
            promptOverride: z.string().optional(),
          })
        )
        .optional(),
    })
    .default({ axes: [] }),
  priority: z.number().int().optional(),
});

const RetryBody = z.object({
  paramOverride: z.record(z.unknown()).optional(),
});

export async function jobRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/v1/jobs', async (req, reply) => {
    const parsed = CreateJobBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    const body = parsed.data;
    if (!hasCapability(body.capabilityId)) {
      reply.code(400).send({ error: `Unknown capability: ${body.capabilityId}` });
      return;
    }
    try {
      const result = createJob({
        accountId: body.accountId,
        capabilityId: body.capabilityId as never,
        modelVariant: body.modelVariant,
        basePrompt: body.basePrompt,
        baseNegativePrompt: body.baseNegativePrompt,
        baseMedia: body.baseMedia,
        baseParameters: body.baseParameters,
        batchMatrix: {
          axes: body.batchMatrix.axes,
          overrides: body.batchMatrix.overrides
            ? Object.fromEntries(Object.entries(body.batchMatrix.overrides).map(([k, v]) => [Number(k), v]))
            : undefined,
        },
        priority: body.priority,
      });
      reply.code(201).send(result);
    } catch (e: unknown) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/v1/jobs', async (req) => {
    const { accountId, limit } = req.query as { accountId?: string; limit?: string };
    if (!accountId) return { jobs: [] };
    return { jobs: listJobs(accountId, limit ? Number(limit) : 50) };
  });

  app.get('/v1/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { accountId } = req.query as { accountId?: string };
    if (!accountId) {
      reply.code(400).send({ error: 'accountId required' });
      return;
    }
    const job = getJob(accountId, id);
    if (!job) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    const subs = listSubJobs(accountId, id);
    reply.send({ job, subJobs: subs });
  });

  app.post('/v1/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { accountId } = req.body as { accountId?: string };
    if (!accountId) {
      reply.code(400).send({ error: 'accountId required' });
      return;
    }
    const count = cancelJob(accountId, id);
    reply.send({ canceled: count });
  });

  app.post('/v1/sub_jobs/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { accountId, ...rest } = (req.body as { accountId?: string } & Record<string, unknown>) ?? {};
    if (!accountId) {
      reply.code(400).send({ error: 'accountId required' });
      return;
    }
    const parsed = RetryBody.safeParse(rest);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    try {
      const newId = retrySubJob(accountId, id, parsed.data.paramOverride);
      reply.code(201).send({ subJobId: newId });
    } catch (e: unknown) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });
}
