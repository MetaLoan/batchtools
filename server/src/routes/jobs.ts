import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { hasCapability } from '../providers/index.js';
import {
  cancelJobForUser,
  deleteJobForUser,
  createJob,
  getJobForUser,
  listJobsForUser,
  listSubJobsForUser,
  retrySubJobForUser,
  listAllSubJobsForUser,
  listFoldersForUser,
  createFolder,
  deleteFolder,
  batchMoveJobsToFolder,
} from '../services/job-service.js';
import { accountExists } from '../services/account-service.js';
import { resolveUrlToStream } from '../services/upload-service.js';
import { db } from '../db/index.js';
import { jobs, subJobs, folders } from '../db/schema.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as archiverModule from 'archiver';
const archiver = (archiverModule.default || archiverModule) as any;
import path from 'node:path';

const MediaInputSchema = z.object({
  kind: z.enum([
    'source_image',
    'source_video',
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
    if (!accountExists(body.accountId)) {
      reply.code(400).send({ error: '账户不存在或已被管理员移除' });
      return;
    }
    try {
      const result = createJob({
        userId: req.currentUser!.id,
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
    const { limit, folderId } = req.query as { limit?: string; folderId?: string };
    const parsedFolderId = folderId === 'null' ? null : folderId;
    return { jobs: listJobsForUser(req.currentUser!.id, limit ? Number(limit) : 50, parsedFolderId) };
  });

  app.get('/v1/sub_jobs', async (req) => {
    const { limit } = req.query as { limit?: string };
    return { subJobs: listAllSubJobsForUser(req.currentUser!.id, limit ? Number(limit) : 100) };
  });

  app.get('/v1/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJobForUser(req.currentUser!.id, id);
    if (!job) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    const subs = listSubJobsForUser(req.currentUser!.id, id);
    reply.send({ job, subJobs: subs });
  });

  app.post('/v1/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const count = cancelJobForUser(req.currentUser!.id, id);
    reply.send({ canceled: count });
  });

  app.delete('/v1/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    deleteJobForUser(req.currentUser!.id, id);
    reply.send({ ok: true });
  });

  app.post('/v1/sub_jobs/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = RetryBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    try {
      const newId = retrySubJobForUser(req.currentUser!.id, id, parsed.data.paramOverride);
      reply.code(201).send({ subJobId: newId });
    } catch (e: unknown) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/v1/folders', async (req) => {
    return { folders: listFoldersForUser(req.currentUser!.id) };
  });

  app.post('/v1/folders', async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name || name.trim() === '') {
      reply.code(400).send({ error: '文件夹名称不能为空' });
      return;
    }
    const folder = createFolder(req.currentUser!.id, name.trim());
    reply.code(201).send(folder);
  });

  app.delete('/v1/folders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    deleteFolder(req.currentUser!.id, id);
    reply.send({ ok: true });
  });

  app.post('/v1/jobs/batch-move', async (req, reply) => {
    const { jobIds, folderId } = req.body as { jobIds?: string[]; folderId?: string | null };
    if (!Array.isArray(jobIds)) {
      reply.code(400).send({ error: 'jobIds 必须是数组' });
      return;
    }
    const targetFolderId = folderId === 'null' || folderId === undefined ? null : folderId;
    batchMoveJobsToFolder(req.currentUser!.id, jobIds, targetFolderId);
    reply.send({ ok: true });
  });

  app.get('/v1/jobs/batch-download', async (req, reply) => {
    const userId = req.currentUser!.id;
    const { jobIds: jobIdsStr, folderId } = req.query as { jobIds?: string; folderId?: string };

    let targetJobIds: string[] = [];

    if (jobIdsStr) {
      targetJobIds = jobIdsStr.split(',').filter(Boolean);
    } else if (folderId) {
      const folderJobs = db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            folderId === 'uncategorized' ? isNull(jobs.folderId) : eq(jobs.folderId, folderId)
          )
        )
        .all();
      targetJobIds = folderJobs.map((j) => j.id);
    }

    if (targetJobIds.length === 0) {
      reply.code(400).send({ error: '没有选中任何任务或文件夹内无任务' });
      return;
    }

    // 查询所有 succeeded 或者 canceled_but_delivered 状态的 subJobs
    const subs = db
      .select({
        id: subJobs.id,
        jobId: subJobs.jobId,
        indexInJob: subJobs.indexInJob,
        resultUrlsJson: subJobs.resultUrlsJson,
      })
      .from(subJobs)
      .where(
        and(
          inArray(subJobs.jobId, targetJobIds),
          eq(subJobs.userId, userId),
          inArray(subJobs.status, ['SUCCEEDED', 'CANCELED_BUT_DELIVERED'])
        )
      )
      .all();

    // 提取视频文件
    interface DownloadItem {
      url: string;
      archivePath: string;
    }
    const downloadList: DownloadItem[] = [];

    let rootFolderPrefix = '';
    if (folderId && folderId !== 'uncategorized') {
      const folderRecord = db
        .select({ name: folders.name })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
        .get();
      if (folderRecord) {
        rootFolderPrefix = `${folderRecord.name}/`;
      }
    } else if (folderId === 'uncategorized') {
      rootFolderPrefix = '未分类/';
    }

    for (const sub of subs) {
      if (!sub.resultUrlsJson) continue;
      try {
        const assets = JSON.parse(sub.resultUrlsJson);
        if (!Array.isArray(assets)) continue;

        let videoAssetIndex = 0;
        for (const asset of assets) {
          const isVideo =
            asset.kind === 'video' ||
            (typeof asset.url === 'string' &&
              /\.(mp4|mov|webm|mkv|avi|flv|3gp|wmv)/i.test(new URL(asset.url).pathname));
          if (!isVideo) continue;

          let ext = '.mp4';
          try {
            const parsedUrl = new URL(asset.url);
            const parsedExt = path.extname(parsedUrl.pathname);
            if (parsedExt) ext = parsedExt;
          } catch (e) {}

          const zipPath = `${rootFolderPrefix}${sub.jobId}/sub_${sub.indexInJob}${videoAssetIndex > 0 ? `_${videoAssetIndex}` : ''}${ext}`;
          downloadList.push({
            url: asset.url,
            archivePath: zipPath,
          });
          videoAssetIndex++;
        }
      } catch (err) {
        // ignore invalid JSON
      }
    }

    if (downloadList.length === 0) {
      reply.code(400).send({ error: '所选任务中没有成功生成的视频文件' });
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="bvp_videos_${Date.now()}.zip"`,
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(reply.raw);

    const appendStream = (stream: any, name: string) => {
      return new Promise<void>((resolve, reject) => {
        let finished = false;
        const onEntry = (entry: any) => {
          if (entry.name === name) {
            cleanup();
            resolve();
          }
        };
        const onError = (err: any) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          if (finished) return;
          finished = true;
          archive.off('entry', onEntry);
          archive.off('error', onError);
          stream.removeListener('error', onError);
        };

        archive.on('entry', onEntry);
        archive.on('error', onError);
        stream.on('error', onError);

        archive.append(stream, { name });
      });
    };

    for (const item of downloadList) {
      try {
        const { stream } = await resolveUrlToStream(item.url, userId);
        await appendStream(stream, item.archivePath);
      } catch (err) {
        console.error(`[batch-download] Failed to zip ${item.url} -> ${item.archivePath}:`, err);
        try {
          archive.append(`Failed to download ${item.url}: ${(err as Error).message}`, {
            name: `${item.archivePath}.error.txt`,
          });
        } catch (appendErr) {
          console.error(`[batch-download] Failed to append error text for ${item.archivePath}`, appendErr);
        }
      }
    }

    await archive.finalize();
  });
}
