import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { AccountSummary, AccountPolicy } from '@bvp/shared';
import { DEFAULT_ACCOUNT_POLICY, DASHSCOPE_SG_ENDPOINT } from '@bvp/shared';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';

export interface CreateAccountInput {
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
      name: input.name,
      apiKeyEncrypted: encryptSecret(input.apiKey),
      endpoint: input.endpoint ?? DASHSCOPE_SG_ENDPOINT,
      disableDataInspection: input.disableDataInspection ? 1 : 0,
      policyJson: JSON.stringify(policy),
      createdAt: now,
    })
    .run();
  return rowToSummary({
    id,
    name: input.name,
    apiKeyEncrypted: '',
    endpoint: input.endpoint ?? DASHSCOPE_SG_ENDPOINT,
    disableDataInspection: input.disableDataInspection ? 1 : 0,
    policyJson: JSON.stringify(policy),
    createdAt: now,
  });
}

export function listAccounts(): AccountSummary[] {
  return db.select().from(accounts).all().map(rowToSummary);
}

export function getAccount(id: string): AccountSummary | null {
  const r = db.select().from(accounts).where(eq(accounts.id, id)).get();
  return r ? rowToSummary(r) : null;
}

export function getAccountApiKey(id: string): string | null {
  const r = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!r) return null;
  return decryptSecret(r.apiKeyEncrypted);
}

export function deleteAccount(id: string): boolean {
  const r = db.delete(accounts).where(eq(accounts.id, id)).run();
  return r.changes > 0;
}

export function updateAccount(id: string, patch: Partial<CreateAccountInput>): AccountSummary | null {
  const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
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
  return getAccount(id);
}
