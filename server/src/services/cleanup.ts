import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subJobs, sessions } from '../db/schema.js';
import { deleteExpiredUploads } from './upload-service.js';

const CLEANUP_TICK_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

function markExpiredResults(): number {
  // Sprize 产物结果链接永久有效，不再标记为已过期
  return 0;
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
