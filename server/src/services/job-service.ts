import { nanoid } from 'nanoid';
import { eq, and, desc, sql, inArray, isNull } from 'drizzle-orm';
import type {
  BatchMatrix,
  MediaInput,
  CapabilityId,
  JobDetail,
  JobSummary,
  SubJobDetail,
  SubJobSummary,
  ResultAsset,
} from '@bvp/shared';
import { db } from '../db/index.js';
import { jobs, subJobs, folders } from '../db/schema.js';
import { getProvider } from '../providers/index.js';
import { expandMatrix } from './batch-expander.js';
import { broadcast } from '../lib/sse.js';

export interface CreateJobInput {
  userId: string;
  accountId: string;
  capabilityId: CapabilityId;
  modelVariant: string;
  basePrompt?: string;
  baseNegativePrompt?: string;
  baseMedia: MediaInput[];
  baseParameters: Record<string, unknown>;
  batchMatrix: BatchMatrix;
  priority?: number;
  folderId?: string | null;
  jobIdPrefix?: string;
}

function sanitizeJobPrefix(prefix: string): string {
  return prefix
    .trim()
    .replace(/\s+([\(（])/g, '$1')
    .replace(/([\)）])\s+/g, '$1')
    .replace(/[\s\/\\:;\*\?"<>\|]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+([\(（])/g, '$1')
    .replace(/([\)）])-+/g, '$1');
}

export function createJob(input: CreateJobInput): { jobId: string; total: number } {
  const cap = getProvider(input.capabilityId).capability;
  const drafts = expandMatrix({
    basePrompt: input.basePrompt,
    baseNegativePrompt: input.baseNegativePrompt,
    baseMedia: input.baseMedia,
    baseParameters: input.baseParameters,
    modelVariant: input.modelVariant,
    batchMatrix: input.batchMatrix,
    maxFanout: cap.batch.platformMaxFanout,
  });

  let prefix = '';
  if (input.jobIdPrefix) {
    prefix = sanitizeJobPrefix(input.jobIdPrefix);
  } else {
    let name = cap.shortName || '任务';
    if (input.modelVariant.includes('2.6') && !name.includes('2.6')) {
      name += '(2.6)';
    } else if (input.modelVariant.includes('2.7') && !name.includes('2.7')) {
      name += '(2.7)';
    }
    prefix = sanitizeJobPrefix(name);
  }
  const lastChar = prefix.slice(-1);
  const separator = (lastChar === ')' || lastChar === '）') ? '' : '-';
  const jobId = `${prefix}${separator}${nanoid(8)}`;
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(jobs)
      .values({
        id: jobId,
        userId: input.userId,
        accountId: input.accountId,
        capabilityId: input.capabilityId,
        modelVariant: input.modelVariant,
        basePrompt: input.basePrompt,
        baseNegativePrompt: input.baseNegativePrompt,
        baseMediaJson: JSON.stringify(input.baseMedia),
        baseParametersJson: JSON.stringify(input.baseParameters),
        batchMatrixJson: JSON.stringify(input.batchMatrix),
        totalSubJobs: drafts.length,
        status: drafts.length === 0 ? 'SUCCEEDED' : 'QUEUED',
        priority: input.priority ?? 50,
        createdAt: now,
        folderId: input.folderId ?? null,
      })
      .run();

    for (const d of drafts) {
      tx.insert(subJobs)
        .values({
          id: nanoid(),
          jobId,
          userId: input.userId,
          accountId: input.accountId,
          capabilityId: input.capabilityId,
          indexInJob: d.indexInJob,
          axesJson: JSON.stringify(d.axes),
          paramsSnapshotJson: JSON.stringify({
            prompt: d.prompt,
            negativePrompt: d.negativePrompt,
            media: d.media,
            params: d.parameters,
            model: d.modelVariant,
          }),
          status: 'PENDING_SUBMIT',
        })
        .run();
    }
  });

  broadcast({
    type: 'job.created',
    userId: input.userId,
    payload: { jobId, total: drafts.length, accountId: input.accountId },
    ts: now,
  });

  return { jobId, total: drafts.length };
}

function safeJsonParse<T>(jsonStr: string | null | undefined, fallback: T): T {
  if (!jsonStr || jsonStr.trim() === '') return fallback;
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed === null ? fallback : (parsed as T);
  } catch (e) {
    console.error(`[safeJsonParse] Failed to parse JSON: "${jsonStr}"`, e);
    return fallback;
  }
}

const defaultParamsSnapshot = {
  prompt: '',
  negativePrompt: '',
  media: [] as MediaInput[],
  params: {} as Record<string, unknown>,
  model: '',
};

function getJobPreviewUrl(jobId: string): string | null {
  const sub = db
    .select({ resultUrlsJson: subJobs.resultUrlsJson })
    .from(subJobs)
    .where(
      and(
        eq(subJobs.jobId, jobId),
        eq(subJobs.status, 'SUCCEEDED')
      )
    )
    .limit(1)
    .get();
  if (!sub || !sub.resultUrlsJson) return null;
  try {
    const assets = JSON.parse(sub.resultUrlsJson);
    if (Array.isArray(assets) && assets.length > 0) {
      return assets[0].url || null;
    }
  } catch (e) {}
  return null;
}

function rowToJobSummary(r: typeof jobs.$inferSelect, stats: { done: number; failed: number }): JobSummary {
  return {
    id: r.id,
    accountId: r.accountId,
    capabilityId: r.capabilityId as CapabilityId,
    modelVariant: r.modelVariant,
    status: r.status as JobSummary['status'],
    totalSubJobs: r.totalSubJobs,
    doneCount: stats.done,
    failedCount: stats.failed,
    priority: r.priority,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt ?? undefined,
    basePrompt: r.basePrompt ?? undefined,
    folderId: r.folderId ?? null,
    previewUrl: getJobPreviewUrl(r.id),
  };
}

export function listJobsForUser(userId: string, limit = 50, folderId?: string | null): JobSummary[] {
  const conditions = [eq(jobs.userId, userId)];
  if (folderId === null) {
    conditions.push(isNull(jobs.folderId));
  } else if (folderId !== undefined) {
    conditions.push(eq(jobs.folderId, folderId));
  }

  const rows = db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .all();
  return rows.map((r) => rowToJobSummary(r, computeJobStats(r.id)));
}

function computeJobStats(jobId: string) {
  const rows = db
    .select({ status: subJobs.status, count: sql<number>`count(*)` })
    .from(subJobs)
    .where(eq(subJobs.jobId, jobId))
    .groupBy(subJobs.status)
    .all();
  let done = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.status === 'SUCCEEDED' || r.status === 'SUCCEEDED_EXPIRED') done += Number(r.count);
    if (r.status === 'FAILED' || r.status === 'DEAD' || r.status === 'LOST') failed += Number(r.count);
  }
  return { done, failed };
}

export function getJobForUser(userId: string, jobId: string): JobDetail | null {
  const r = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .get();
  if (!r) return null;
  return {
    ...rowToJobSummary(r, computeJobStats(r.id)),
    baseNegativePrompt: r.baseNegativePrompt ?? undefined,
    baseMedia: safeJsonParse<MediaInput[]>(r.baseMediaJson, []),
    baseParameters: safeJsonParse<Record<string, unknown>>(r.baseParametersJson, {}),
    batchMatrix: {
      axes: [],
      ...safeJsonParse<any>(r.batchMatrixJson, {}),
    },
  };
}

export function listSubJobsForUser(userId: string, jobId: string): SubJobDetail[] {
  const rows = db
    .select()
    .from(subJobs)
    .where(and(eq(subJobs.jobId, jobId), eq(subJobs.userId, userId)))
    .orderBy(subJobs.indexInJob)
    .all();
  return rows.map(rowToSubJobDetail);
}

export function listAllSubJobsForUser(userId: string, limit = 100): SubJobDetail[] {
  const rows = db
    .select()
    .from(subJobs)
    .where(eq(subJobs.userId, userId))
    .orderBy(desc(subJobs.submittedAt))
    .limit(limit)
    .all();
  return rows.map(rowToSubJobDetail);
}

export function rowToSubJobDetail(r: typeof subJobs.$inferSelect): SubJobDetail {
  const lastError = r.lastErrorJson ? safeJsonParse<any>(r.lastErrorJson, null) : undefined;
  return {
    id: r.id,
    jobId: r.jobId,
    accountId: r.accountId,
    capabilityId: r.capabilityId as CapabilityId,
    indexInJob: r.indexInJob,
    axes: safeJsonParse<Record<string, unknown>>(r.axesJson, {}),
    status: r.status as SubJobSummary['status'],
    providerTaskId: r.providerTaskId ?? undefined,
    attempts: r.attempts,
    resultUrls: r.resultUrlsJson ? safeJsonParse<ResultAsset[]>(r.resultUrlsJson, []) : undefined,
    errorCode: lastError?.code,
    errorMessage: lastError?.message,
    submittedAt: r.submittedAt ?? undefined,
    finishedAt: r.finishedAt ?? undefined,
    paramsSnapshot: {
      ...defaultParamsSnapshot,
      ...safeJsonParse<any>(r.paramsSnapshotJson, {}),
    },
    origPrompt: r.origPrompt ?? undefined,
    actualPrompt: r.actualPrompt ?? undefined,
    pollNextAt: r.pollNextAt ?? undefined,
    originSubJobId: r.originSubJobId ?? undefined,
    version: r.version,
  };
}

export function cancelJobForUser(userId: string, jobId: string): number {
  const now = Date.now();
  let count = 0;
  db.transaction((tx) => {
    const subs = tx
      .select()
      .from(subJobs)
      .where(and(eq(subJobs.jobId, jobId), eq(subJobs.userId, userId)))
      .all();
    for (const s of subs) {
      if (s.status === 'PENDING_SUBMIT' || s.status === 'RETRY_QUEUED') {
        tx.update(subJobs)
          .set({ status: 'CANCELED', finishedAt: now, version: s.version + 1 })
          .where(eq(subJobs.id, s.id))
          .run();
        count++;
      } else if (s.status === 'SUBMITTED' || s.status === 'RUNNING') {
        tx.update(subJobs)
          .set({ status: 'CANCELING', version: s.version + 1 })
          .where(eq(subJobs.id, s.id))
          .run();
        count++;
      }
    }
    tx.update(jobs).set({ status: 'CANCELED' }).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).run();
  });
  broadcast({
    type: 'job.updated',
    userId,
    payload: { jobId, status: 'CANCELED' },
    ts: now,
  });
  return count;
}

export function deleteJobForUser(userId: string, jobId: string): void {
  db.transaction((tx) => {
    tx.delete(subJobs)
      .where(and(eq(subJobs.jobId, jobId), eq(subJobs.userId, userId)))
      .run();
    tx.delete(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
      .run();
  });
}

export function batchDeleteJobsForUser(userId: string, jobIds: string[]): void {
  if (jobIds.length === 0) return;
  db.transaction((tx) => {
    tx.delete(subJobs)
      .where(and(inArray(subJobs.jobId, jobIds), eq(subJobs.userId, userId)))
      .run();
    tx.delete(jobs)
      .where(and(inArray(jobs.id, jobIds), eq(jobs.userId, userId)))
      .run();
  });
}

export function retrySubJobForUser(
  userId: string,
  subJobId: string,
  paramOverride?: Record<string, unknown>
): string {
  const original = db
    .select()
    .from(subJobs)
    .where(and(eq(subJobs.id, subJobId), eq(subJobs.userId, userId)))
    .get();
  if (!original) throw new Error('SubJob not found');
  const snap = safeJsonParse<any>(original.paramsSnapshotJson, {});
  const mergedSnap = {
    ...defaultParamsSnapshot,
    ...snap,
  };
  if (paramOverride) {
    mergedSnap.params = { ...mergedSnap.params, ...paramOverride };
  }
  const newId = nanoid();
  const indexInJob =
    db
      .select({ max: sql<number>`MAX(${subJobs.indexInJob})` })
      .from(subJobs)
      .where(eq(subJobs.jobId, original.jobId))
      .get()?.max ?? 0;
  db.insert(subJobs)
    .values({
      id: newId,
      jobId: original.jobId,
      userId: original.userId,
      accountId: original.accountId,
      capabilityId: original.capabilityId,
      indexInJob: (indexInJob ?? 0) + 1,
      axesJson: original.axesJson,
      paramsSnapshotJson: JSON.stringify(mergedSnap),
      status: 'PENDING_SUBMIT',
      originSubJobId: subJobId,
    })
    .run();
  return newId;
}

export interface Folder {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

export function listFoldersForUser(userId: string): Folder[] {
  return db
    .select()
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(desc(folders.createdAt))
    .all() as Folder[];
}

export function createFolder(userId: string, name: string): Folder {
  const folderId = nanoid();
  const now = Date.now();
  const folder = {
    id: folderId,
    userId,
    name,
    createdAt: now,
  };
  db.insert(folders).values(folder).run();
  return folder;
}

export function deleteFolder(userId: string, folderId: string): void {
  db.transaction((tx) => {
    // Reset folderId to null for all jobs in this folder
    tx.update(jobs)
      .set({ folderId: null })
      .where(and(eq(jobs.folderId, folderId), eq(jobs.userId, userId)))
      .run();

    // Delete folder
    tx.delete(folders)
      .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
      .run();
  });
}

export function batchMoveJobsToFolder(userId: string, jobIds: string[], folderId: string | null): void {
  if (jobIds.length === 0) return;
  db.update(jobs)
    .set({ folderId })
    .where(and(inArray(jobs.id, jobIds), eq(jobs.userId, userId)))
    .run();
}

