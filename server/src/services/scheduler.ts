import { eq, and, asc, lte, or, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subJobs, jobs } from '../db/schema.js';
import { getProvider } from '../providers/index.js';
import { getAccount, getAccountApiKey } from './account-service.js';
import { broadcast } from '../lib/sse.js';
import {
  globalSubmitBucket,
  getAccountSubmitBucket,
} from './token-bucket.js';
import {
  incrementInFlight,
  getInFlight,
  decrementInFlight,
} from './concurrency.js';
import type { CapabilityId, MediaInput, ProviderContext } from '@bvp/shared';
import { nanoid } from 'nanoid';

const SCHEDULER_TICK_MS = 1000;
const BATCH_SIZE = 50;
let timer: NodeJS.Timeout | null = null;
let running = false;

function pickReady(): (typeof subJobs.$inferSelect)[] {
  const now = Date.now();
  return db
    .select()
    .from(subJobs)
    .where(
      or(
        eq(subJobs.status, 'PENDING_SUBMIT'),
        and(eq(subJobs.status, 'RETRY_QUEUED'), or(isNull(subJobs.pollNextAt), lte(subJobs.pollNextAt, now)))
      )
    )
    .orderBy(asc(subJobs.indexInJob))
    .limit(BATCH_SIZE)
    .all();
}

async function trySubmit(row: typeof subJobs.$inferSelect): Promise<void> {
  const account = getAccount(row.accountId);
  if (!account) {
    db.update(subJobs)
      .set({
        status: 'FAILED',
        lastErrorJson: JSON.stringify({ code: 'AccountNotFound', message: 'Account no longer exists' }),
        finishedAt: Date.now(),
      })
      .where(eq(subJobs.id, row.id))
      .run();
    return;
  }

  const inFlight = getInFlight(row.accountId, row.capabilityId as CapabilityId);
  if (inFlight >= account.policy.maxConcurrentRunning) return;

  const accountBucket = getAccountSubmitBucket(row.accountId, account.policy.submitRatePerMin);
  if (!accountBucket.tryTake()) return;
  if (!globalSubmitBucket.tryTake()) return;

  const apiKey = getAccountApiKey(row.accountId);
  if (!apiKey) {
    db.update(subJobs)
      .set({
        status: 'FAILED',
        lastErrorJson: JSON.stringify({ code: 'NoApiKey', message: 'Account has no api key' }),
        finishedAt: Date.now(),
      })
      .where(eq(subJobs.id, row.id))
      .run();
    return;
  }

  const provider = getProvider(row.capabilityId as CapabilityId);
  const snap = JSON.parse(row.paramsSnapshotJson) as {
    prompt?: string;
    negativePrompt?: string;
    media: MediaInput[];
    params: Record<string, unknown>;
    model: string;
  };

  const ctx: ProviderContext = {
    apiKey,
    endpoint: account.endpoint,
    accountId: account.id,
    requestId: nanoid(),
    disableDataInspection: account.disableDataInspection,
  };

  try {
    const handle = await provider.submit(
      {
        capabilityId: row.capabilityId as CapabilityId,
        modelVariant: snap.model,
        prompt: snap.prompt,
        negativePrompt: snap.negativePrompt,
        media: snap.media,
        parameters: snap.params,
      },
      ctx
    );

    const now = Date.now();
    const initialPollMs = provider.capability.pollIntervalSec.initial * 1000;
    db.update(subJobs)
      .set({
        status: handle.isSynthetic ? 'RUNNING' : 'SUBMITTED',
        providerTaskId: handle.providerTaskId,
        isSynthetic: handle.isSynthetic ? 1 : 0,
        submittedAt: now,
        pollNextAt: now + (handle.isSynthetic ? 0 : initialPollMs),
        attempts: row.attempts + 1,
        version: row.version + 1,
      })
      .where(eq(subJobs.id, row.id))
      .run();
    incrementInFlight(row.accountId, row.capabilityId as CapabilityId);

    db.update(jobs)
      .set({ status: 'RUNNING' })
      .where(and(eq(jobs.id, row.jobId), eq(jobs.status, 'QUEUED')))
      .run();

    broadcast({
      type: 'sub_job.submitted',
      accountId: row.accountId,
      payload: { subJobId: row.id, jobId: row.jobId, providerTaskId: handle.providerTaskId },
      ts: now,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const account2 = getAccount(row.accountId);
    const maxAttempts = account2?.policy.retry.maxAttempts ?? 3;
    const backoff = account2?.policy.retry.backoffSec ?? [10, 30, 90];
    const attempts = row.attempts + 1;
    const retryable = !e.code || !/^(InvalidApiKey|InvalidParameter|DataInspection)/.test(e.code);
    const now = Date.now();
    if (retryable && attempts < maxAttempts) {
      const delaySec = backoff[Math.min(attempts - 1, backoff.length - 1)] ?? 30;
      db.update(subJobs)
        .set({
          status: 'RETRY_QUEUED',
          attempts,
          pollNextAt: now + delaySec * 1000,
          lastErrorJson: JSON.stringify({ code: e.code, message: e.message, at: now }),
          version: row.version + 1,
        })
        .where(eq(subJobs.id, row.id))
        .run();
    } else {
      db.update(subJobs)
        .set({
          status: 'FAILED',
          attempts,
          finishedAt: now,
          lastErrorJson: JSON.stringify({ code: e.code, message: e.message, at: now }),
          version: row.version + 1,
        })
        .where(eq(subJobs.id, row.id))
        .run();
      broadcast({
        type: 'sub_job.finished',
        accountId: row.accountId,
        payload: { subJobId: row.id, jobId: row.jobId, status: 'FAILED' },
        ts: now,
      });
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const ready = pickReady();
    for (const row of ready) {
      try {
        await trySubmit(row);
      } catch (e) {
        console.error('Scheduler trySubmit error', e);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, SCHEDULER_TICK_MS);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function releaseInFlight(accountId: string, capabilityId: CapabilityId) {
  decrementInFlight(accountId, capabilityId);
}
