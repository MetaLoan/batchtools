import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import type { AccountSummary, AccountPolicy } from '@bvp/shared';
import { DEFAULT_ACCOUNT_POLICY, DASHSCOPE_SG_ENDPOINT } from '@bvp/shared';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';

export interface CreateAccountInput {
  userId: string;
  name: string;
  apiKey: string;
  endpoint?: string;
  disableDataInspection?: boolean;
  policy?: Partial<AccountPolicy>;
}

function rowToSummary(r: typeof accounts.$inferSelect): AccountSummary {
  return {
    id: r.id,
    name: r.name,
    endpoint: r.endpoint,
    disableDataInspection: !!r.disableDataInspection,
    policy: JSON.parse(r.policyJson) as AccountPolicy,
    createdAt: r.createdAt,
  };
}

export function createAccount(input: CreateAccountInput): AccountSummary {
  const id = nanoid();
  const now = Date.now();
  const policy: AccountPolicy = { ...DEFAULT_ACCOUNT_POLICY, ...input.policy };
  db.insert(accounts)
    .values({
      id,
      userId: input.userId,
      name: input.name,
      apiKeyEncrypted: encryptSecret(input.apiKey),
      endpoint: input.endpoint ?? DASHSCOPE_SG_ENDPOINT,
      disableDataInspection: input.disableDataInspection ? 1 : 0,
      policyJson: JSON.stringify(policy),
      createdAt: now,
    })
    .run();
  return {
    id,
    name: input.name,
    endpoint: input.endpoint ?? DASHSCOPE_SG_ENDPOINT,
    disableDataInspection: !!input.disableDataInspection,
    policy,
    createdAt: now,
  };
}

export function listAccountsForUser(userId: string): AccountSummary[] {
  return db.select().from(accounts).where(eq(accounts.userId, userId)).all().map(rowToSummary);
}

export function getAccountForUser(userId: string, id: string): AccountSummary | null {
  const r = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .get();
  return r ? rowToSummary(r) : null;
}

// Internal: scheduler/poller don't have user context, only accountId.
// Caller must ensure they're not exposing this via HTTP.
export function getAccountInternal(id: string): AccountSummary | null {
  const r = db.select().from(accounts).where(eq(accounts.id, id)).get();
  return r ? rowToSummary(r) : null;
}

export function getAccountApiKey(id: string): string | null {
  const r = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!r) return null;
  return decryptSecret(r.apiKeyEncrypted);
}

export function accountBelongsToUser(userId: string, accountId: string): boolean {
  const r = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .get();
  return !!r;
}

export function deleteAccountForUser(userId: string, id: string): boolean {
  const r = db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId))).run();
  return r.changes > 0;
}

export function updateAccountForUser(
  userId: string,
  id: string,
  patch: Partial<Omit<CreateAccountInput, 'userId'>>
): AccountSummary | null {
  const existing = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .get();
  if (!existing) return null;
  const next: Partial<typeof accounts.$inferInsert> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.apiKey) next.apiKeyEncrypted = encryptSecret(patch.apiKey);
  if (patch.endpoint !== undefined) next.endpoint = patch.endpoint;
  if (patch.disableDataInspection !== undefined)
    next.disableDataInspection = patch.disableDataInspection ? 1 : 0;
  if (patch.policy) {
    const cur = JSON.parse(existing.policyJson);
    next.policyJson = JSON.stringify({ ...cur, ...patch.policy });
  }
  db.update(accounts).set(next).where(eq(accounts.id, id)).run();
  return getAccountForUser(userId, id);
}
