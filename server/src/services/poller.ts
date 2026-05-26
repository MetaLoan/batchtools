import { eq, and, sql, lte, or, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subJobs, jobs } from '../db/schema.js';
import { getProvider } from '../providers/index.js';
import { getAccountInternal as getAccount, getAccountApiKey } from './account-service.js';
import { broadcast } from '../lib/sse.js';
import { globalPollBucket } from './token-bucket.js';
import { decrementInFlight } from './concurrency.js';
import {
  SUB_JOB_IN_FLIGHT_STATUSES,
  type CapabilityId,
  type ProviderContext,
  type ProviderHandle,
} from '@bvp/shared';
import { nanoid } from 'nanoid';

const POLLER_TICK_MS = 2000;
let timer: NodeJS.Timeout | null = null;
let running = false;

function nextBackoff(ageMs: number): number {
  if (ageMs < 20_000) return 6_000;
  if (ageMs < 120_000) return 10_000;
  if (ageMs < 300_000) return 15_000;
  if (ageMs < 600_000) return 20_000;
  return 30_000;
}

function pickDue() {
  const now = Date.now();
  return db
    .select()
    .from(subJobs)
    .where(
      and(
        inArray(subJobs.status, SUB_JOB_IN_FLIGHT_STATUSES),
        or(sql`${subJobs.pollNextAt} IS NULL`, lte(subJobs.pollNextAt, now))
      )
    )
    .limit(50)
    .all();
}

async function pollOne(row: typeof subJobs.$inferSelect): Promise<void> {
  const account = getAccount(row.accountId);
  if (!account) return;
  const apiKey = getAccountApiKey(row.accountId);
  if (!apiKey) return;
  if (!row.providerTaskId) return;

  if (!globalPollBucket.tryTake()) {
    const now = Date.now();
    db.update(subJobs).set({ pollNextAt: now + 1000 }).where(eq(subJobs.id, row.id)).run();
    return;
  }

  const provider = getProvider(row.capabilityId as CapabilityId);
  const handle: ProviderHandle = {
    providerTaskId: row.providerTaskId,
    isSynthetic: !!row.isSynthetic,
    submittedAt: new Date(row.submittedAt ?? Date.now()).toISOString(),
  };
  const ctx: ProviderContext = {
    apiKey,
    endpoint: account.endpoint,
    queryEndpoint: account.queryEndpoint,
    accountId: account.id,
    requestId: nanoid(),
    disableDataInspection: account.disableDataInspection,
  };

  try {
    const result = await provider.poll(handle, ctx);
    const now = Date.now();

    if (result.status === 'SUCCEEDED') {
      let finalResultUrls = result.resultUrls;

      try {
        const snapshotParams = row.paramsSnapshotJson ? JSON.parse(row.paramsSnapshotJson) : {};
        const params = snapshotParams.params || {};
        const audioUrl = params['extra.audioUrl'];

        if (audioUrl && finalResultUrls && finalResultUrls.length > 0) {
          console.log(`[poller] Post-processing audio mixing for subJob ${row.id}. Audio: ${audioUrl}`);
          const videoUrl = finalResultUrls[0].url;

          let width = 720;
          let height = 1280;
          const sizeStr = params['parameters.size'];
          if (typeof sizeStr === 'string' && sizeStr.includes('*')) {
            const parts = sizeStr.split('*');
            const w = parseInt(parts[0]);
            const h = parseInt(parts[1]);
            if (!isNaN(w) && !isNaN(h)) {
              width = w;
              height = h;
            }
          } else {
            const ratioStr = params['parameters.ratio'];
            if (ratioStr === '9:16') {
              width = 720;
              height = 1280;
            } else if (ratioStr === '16:9') {
              width = 1280;
              height = 720;
            }
          }

          let duration = 10;
          const durationVal = params['parameters.duration'];
          if (typeof durationVal === 'number') {
            duration = durationVal;
          } else if (typeof durationVal === 'string') {
            const parsed = parseInt(durationVal);
            if (!isNaN(parsed)) duration = parsed;
          }

          const { renderVideo } = await import('./editor-service.js');
          const mixedUrl = await renderVideo({
            width,
            height,
            muteOriginal: true,
            audioUrl,
            segments: [{ url: videoUrl, start: 0, duration }]
          }, row.userId, {
            info: (m) => console.log(`[poller-mix] ${m}`),
            debug: (m) => console.log(`[poller-mix-debug] ${m}`),
            warn: (m, e) => console.warn(`[poller-mix-warn] ${m}`, e),
            error: (m, e) => console.error(`[poller-mix-error] ${m}`, e),
          });

          finalResultUrls = [{
            ...finalResultUrls[0],
            url: mixedUrl
          }];
          console.log(`[poller] Audio mixing succeeded for subJob ${row.id}. Output: ${mixedUrl}`);
        }
      } catch (mixErr) {
        console.error(`[poller] Audio mixing failed for subJob ${row.id}:`, mixErr);
      }

      if (row.status === 'CANCELING') {
        db.update(subJobs)
          .set({
            status: 'CANCELED_BUT_DELIVERED',
            resultUrlsJson: finalResultUrls ? JSON.stringify(finalResultUrls) : null,
            finishedAt: now,
            origPrompt: result.origPrompt,
            actualPrompt: result.actualPrompt,
            version: row.version + 1,
          })
          .where(eq(subJobs.id, row.id))
          .run();
      } else {
        db.update(subJobs)
          .set({
            status: 'SUCCEEDED',
            resultUrlsJson: finalResultUrls ? JSON.stringify(finalResultUrls) : null,
            finishedAt: now,
            origPrompt: result.origPrompt,
            actualPrompt: result.actualPrompt,
            version: row.version + 1,
          })
          .where(eq(subJobs.id, row.id))
          .run();
      }
      decrementInFlight(row.accountId, row.capabilityId as CapabilityId);
      broadcast({
        type: 'sub_job.finished',
        userId: row.userId,
        payload: {
          subJobId: row.id,
          jobId: row.jobId,
          status: 'SUCCEEDED',
          resultUrls: finalResultUrls,
        },
        ts: now,
      });
      maybeFinalizeJob(row.jobId, row.userId);
      return;
    }

    if (result.status === 'FAILED' || result.status === 'CANCELED' || result.status === 'UNKNOWN') {
      const finalStatus =
        row.status === 'CANCELING'
          ? 'CANCELED'
          : result.status === 'UNKNOWN'
            ? 'LOST'
            : result.status === 'CANCELED'
              ? 'CANCELED'
              : 'FAILED';
      db.update(subJobs)
        .set({
          status: finalStatus,
          finishedAt: now,
          lastErrorJson: JSON.stringify({ code: result.errorCode, message: result.errorMessage, at: now }),
          version: row.version + 1,
        })
        .where(eq(subJobs.id, row.id))
        .run();
      decrementInFlight(row.accountId, row.capabilityId as CapabilityId);
      broadcast({
        type: 'sub_job.finished',
        userId: row.userId,
        payload: { subJobId: row.id, jobId: row.jobId, status: finalStatus },
        ts: now,
      });
      maybeFinalizeJob(row.jobId, row.userId);
      return;
    }

    // Still pending/running: schedule next poll
    const age = now - (row.submittedAt ?? now);
    const nextDelta = nextBackoff(age);
    db.update(subJobs)
      .set({
        status: result.status === 'RUNNING' ? 'RUNNING' : row.status,
        pollNextAt: now + nextDelta,
        version: row.version + 1,
      })
      .where(eq(subJobs.id, row.id))
      .run();
    broadcast({
      type: 'sub_job.updated',
      userId: row.userId,
      payload: { subJobId: row.id, jobId: row.jobId, status: result.status },
      ts: now,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const now = Date.now();
    db.update(subJobs)
      .set({
        pollNextAt: now + 30_000,
        lastErrorJson: JSON.stringify({ code: e.code, message: e.message, at: now, kind: 'poll' }),
      })
      .where(eq(subJobs.id, row.id))
      .run();
  }
}

function maybeFinalizeJob(jobId: string, userId: string) {
  const counts = db
    .select({ status: subJobs.status, count: sql<number>`count(*)` })
    .from(subJobs)
    .where(eq(subJobs.jobId, jobId))
    .groupBy(subJobs.status)
    .all();
  let total = 0;
  let done = 0;
  let failed = 0;
  let inFlight = 0;
  for (const r of counts) {
    const c = Number(r.count);
    total += c;
    if (r.status === 'SUCCEEDED' || r.status === 'SUCCEEDED_EXPIRED') done += c;
    else if (
      r.status === 'FAILED' ||
      r.status === 'DEAD' ||
      r.status === 'LOST' ||
      r.status === 'CANCELED' ||
      r.status === 'CANCELED_BUT_DELIVERED' ||
      r.status === 'INVALID'
    )
      failed += c;
    else inFlight += c;
  }
  if (inFlight > 0) return;
  const finalStatus =
    failed === 0 ? 'SUCCEEDED' : done === 0 ? 'FAILED' : 'PARTIAL_SUCCESS';
  db.update(jobs)
    .set({ status: finalStatus, finishedAt: Date.now() })
    .where(eq(jobs.id, jobId))
    .run();
  broadcast({ type: 'job.updated', userId, payload: { jobId, status: finalStatus }, ts: Date.now() });
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = pickDue();
    const byAccount = new Map<string, (typeof subJobs.$inferSelect)[]>();
    for (const r of due) {
      const arr = byAccount.get(r.accountId) ?? [];
      arr.push(r);
      byAccount.set(r.accountId, arr);
    }
    for (const [, rows] of byAccount) {
      for (const r of rows) {
        await pollOne(r);
        await new Promise((res) => setTimeout(res, 200));
      }
    }
  } finally {
    running = false;
  }
}

export function startPoller(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, POLLER_TICK_MS);
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
