import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accountConcurrency, subJobs } from '../db/schema.js';
import { SUB_JOB_IN_FLIGHT_STATUSES, type CapabilityId } from '@bvp/shared';

export function getInFlight(accountId: string, capabilityId: CapabilityId): number {
  const r = db
    .select()
    .from(accountConcurrency)
    .where(and(eq(accountConcurrency.accountId, accountId), eq(accountConcurrency.capabilityId, capabilityId)))
    .get();
  return r?.inFlight ?? 0;
}

export function incrementInFlight(accountId: string, capabilityId: CapabilityId): void {
  const existing = db
    .select()
    .from(accountConcurrency)
    .where(and(eq(accountConcurrency.accountId, accountId), eq(accountConcurrency.capabilityId, capabilityId)))
    .get();
  if (existing) {
    db.update(accountConcurrency)
      .set({ inFlight: existing.inFlight + 1 })
      .where(and(eq(accountConcurrency.accountId, accountId), eq(accountConcurrency.capabilityId, capabilityId)))
      .run();
  } else {
    db.insert(accountConcurrency).values({ accountId, capabilityId, inFlight: 1 }).run();
  }
}

export function decrementInFlight(accountId: string, capabilityId: CapabilityId): void {
  const existing = db
    .select()
    .from(accountConcurrency)
    .where(and(eq(accountConcurrency.accountId, accountId), eq(accountConcurrency.capabilityId, capabilityId)))
    .get();
  if (!existing) return;
  const next = Math.max(0, existing.inFlight - 1);
  db.update(accountConcurrency)
    .set({ inFlight: next })
    .where(and(eq(accountConcurrency.accountId, accountId), eq(accountConcurrency.capabilityId, capabilityId)))
    .run();
}

export function rebuildConcurrencyFromDb(): void {
  db.delete(accountConcurrency).run();
  const rows = db
    .select({
      accountId: subJobs.accountId,
      capabilityId: subJobs.capabilityId,
      count: sql<number>`count(*)`,
    })
    .from(subJobs)
    .where(sql`${subJobs.status} IN (${sql.join(SUB_JOB_IN_FLIGHT_STATUSES.map((s) => sql`${s}`), sql`, `)})`)
    .groupBy(subJobs.accountId, subJobs.capabilityId)
    .all();
  for (const r of rows) {
    db.insert(accountConcurrency).values({
      accountId: r.accountId,
      capabilityId: r.capabilityId,
      inFlight: Number(r.count),
    }).run();
  }
}
