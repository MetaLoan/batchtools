import { nanoid } from 'nanoid';
import { eq, and, desc, sql } from 'drizzle-orm';
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
import { jobs, subJobs } from '../db/schema.js';
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

  const jobId = nanoid();
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
  };
}

export function listJobsForUser(userId: string, limit = 50): JobSummary[] {
  const rows = db
    .select()
    .from(jobs)
    .where(eq(jobs.userId, userId))
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
    baseMedia: JSON.parse(r.baseMediaJson),
    baseParameters: JSON.parse(r.baseParametersJson),
    batchMatrix: JSON.parse(r.batchMatrixJson),
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
  const lastError = r.lastErrorJson ? JSON.parse(r.lastErrorJson) : undefined;
  return {
    id: r.id,
    jobId: r.jobId,
    accountId: r.accountId,
    capabilityId: r.capabilityId as CapabilityId,
    indexInJob: r.indexInJob,
    axes: JSON.parse(r.axesJson),
    status: r.status as SubJobSummary['status'],
    providerTaskId: r.providerTaskId ?? undefined,
    attempts: r.attempts,
    resultUrls: r.resultUrlsJson ? (JSON.parse(r.resultUrlsJson) as ResultAsset[]) : undefined,
    errorCode: lastError?.code,
    errorMessage: lastError?.message,
    submittedAt: r.submittedAt ?? undefined,
    finishedAt: r.finishedAt ?? undefined,
    paramsSnapshot: JSON.parse(r.paramsSnapshotJson),
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
  const snap = JSON.parse(original.paramsSnapshotJson);
  if (paramOverride) snap.params = { ...snap.params, ...paramOverride };
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
      paramsSnapshotJson: JSON.stringify(snap),
      status: 'PENDING_SUBMIT',
      originSubJobId: subJobId,
    })
    .run();
  return newId;
}
