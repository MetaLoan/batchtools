import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { request } from 'undici';
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
  const cleanKey = input.apiKey.trim();
  if (!cleanKey) throw new Error('API Key 不能为空');
  db.insert(accounts)
    .values({
      id,
      userId: input.userId,
      name: input.name,
      apiKeyEncrypted: encryptSecret(cleanKey),
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
  // Defense-in-depth: trim on read so any pre-existing whitespace in stored keys is normalised.
  return decryptSecret(r.apiKeyEncrypted).trim();
}

export function accountBelongsToUser(userId: string, accountId: string): boolean {
  const r = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .get();
  return !!r;
}

export interface TestConnectionResult {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  hint?: string;
}

/**
 * Cheap probe to verify a stored API key actually authenticates with DashScope.
 * Hits GET /api/v1/tasks/<random-id>:
 *  - 401 + InvalidApiKey  → wrong key / wrong region
 *  - 404 / 400 with code "TaskNotFound" or similar → key is VALID (auth passed)
 *  - anything else → surface raw
 */
export async function testAccountConnection(
  userId: string,
  id: string
): Promise<TestConnectionResult> {
  const acc = getAccountForUser(userId, id);
  if (!acc) return { ok: false, message: '账户不存在' };
  const apiKey = getAccountApiKey(id);
  if (!apiKey) return { ok: false, message: '账户未配置 API Key' };

  const url = acc.endpoint.replace(/\/$/, '') + '/api/v1/tasks/test-connection-probe';
  try {
    const res = await request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await res.body.text();
    let parsed: unknown = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = { rawText: body };
    }
    const code = (parsed as { code?: string }).code;
    const message = (parsed as { message?: string }).message;

    if (res.statusCode === 200) {
      // Unexpected but ok — connectivity confirmed
      return { ok: true, status: res.statusCode };
    }
    if (code === 'InvalidApiKey') {
      return {
        ok: false,
        status: res.statusCode,
        code,
        message,
        hint:
          '可能原因：Key 与 endpoint 地域不匹配（北京 Key 不能用于新加坡站，反之亦然），或 Key 已吊销 / 没在该地域开通。',
      };
    }
    // Auth passed but task ID is bogus — that means the key works.
    if (res.statusCode === 404 || /not found|UNKNOWN|invalid task/i.test(message ?? '') || code === 'InvalidParameter') {
      return { ok: true, status: res.statusCode, code, message: '认证通过' };
    }
    return { ok: false, status: res.statusCode, code, message };
  } catch (e) {
    return { ok: false, message: (e as Error).message, hint: '网络错误或 endpoint 不可达' };
  }
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
  if (patch.apiKey) {
    const cleanKey = patch.apiKey.trim();
    if (!cleanKey) throw new Error('API Key 不能为空');
    next.apiKeyEncrypted = encryptSecret(cleanKey);
  }
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
