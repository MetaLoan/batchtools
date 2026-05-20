import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subJobs, sessions } from '../db/schema.js';
import { deleteExpiredUploads } from './upload-service.js';

const CLEANUP_TICK_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

function markExpiredResults(): number {
  const now = Date.now();
  const rows = db
    .select()
    .from(subJobs)
    .where(eq(subJobs.status, 'SUCCEEDED'))
    .all();
  let count = 0;
  for (const r of rows) {
    if (!r.resultUrlsJson) continue;
    let urls: { expiresAt?: string }[] = [];
    try {
      urls = JSON.parse(r.resultUrlsJson);
    } catch {
      continue;
    }
    if (urls.length === 0) continue;
    const allExpired = urls.every((u) => u.expiresAt && new Date(u.expiresAt).getTime() < now);
    if (allExpired) {
      db.update(subJobs).set({ status: 'SUCCEEDED_EXPIRED' }).where(eq(subJobs.id, r.id)).run();
      count++;
    }
  }
  return count;
}

function expireOldInFlight(): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const rows = db
    .select()
    .from(subJobs)
    .where(and(sql`${subJobs.status} IN ('SUBMITTED','RUNNING','CANCELING')`, sql`${subJobs.submittedAt} < ${cutoff}`))
    .all();
  let count = 0;
  for (const r of rows) {
    db.update(subJobs).set({ status: 'LOST', finishedAt: Date.now() }).where(eq(subJobs.id, r.id)).run();
    count++;
  }
  return count;
}

function expireSessions(): number {
  const now = Date.now();
  const r = db.delete(sessions).where(sql`${sessions.expiresAt} < ${now}`).run();
  return r.changes;
}

function runCleanup() {
  try {
    const uploads = deleteExpiredUploads();
    const results = markExpiredResults();
    const lost = expireOldInFlight();
    const sess = expireSessions();
    console.log(
      `[cleanup] uploads=${uploads} results_expired=${results} lost=${lost} sessions=${sess}`
    );
  } catch (e) {
    console.error('[cleanup] error', e);
  }
}

export function startCleanup(): void {
  if (timer) return;
  runCleanup();
  timer = setInterval(runCleanup, CLEANUP_TICK_MS);
}

export function stopCleanup(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
