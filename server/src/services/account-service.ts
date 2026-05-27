import { eq } from 'drizzle-orm';
import { request } from 'undici';
import { type AccountSummary, type AccountPolicy, DEFAULT_ACCOUNT_POLICY } from '@bvp/shared';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { decryptSecret } from '../lib/crypto.js';
import { buildDashScopeUrl } from '../providers/dashscope/base-client.js';

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

function rowToSummary(r: typeof accounts.$inferSelect): AccountSummary {
  return {
    id: r.id,
    name: r.name,
    endpoint: r.endpoint,
    queryEndpoint: r.queryEndpoint ?? undefined,
    disableDataInspection: !!r.disableDataInspection,
    policy: safeJsonParse<AccountPolicy>(r.policyJson, DEFAULT_ACCOUNT_POLICY),
    createdAt: r.createdAt,
  };
}

export function listAllAccounts(): AccountSummary[] {
  return db.select().from(accounts).all().map(rowToSummary);
}

export function getAccountById(id: string): AccountSummary | null {
  const r = db.select().from(accounts).where(eq(accounts.id, id)).get();
  return r ? rowToSummary(r) : null;
}

// Internal alias used by scheduler/poller (kept for backward compatibility with existing imports).
export function getAccountInternal(id: string): AccountSummary | null {
  return getAccountById(id);
}

export function getAccountApiKey(id: string): string | null {
  const r = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!r) return null;
  return decryptSecret(r.apiKeyEncrypted).trim();
}

export function accountExists(id: string): boolean {
  return !!db.select().from(accounts).where(eq(accounts.id, id)).get();
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
 *  - 404 / 400 with "task not found" → key is VALID (auth passed)
 */
export async function testAccountConnection(id: string): Promise<TestConnectionResult> {
  const acc = getAccountById(id);
  if (!acc) return { ok: false, message: '账户不存在' };
  const apiKey = getAccountApiKey(id);
  if (!apiKey) return { ok: false, message: '账户未配置 API Key' };

  // Use queryEndpoint for the probe since /tasks lives under the query base for sprize-style proxies
  const probeBase = acc.queryEndpoint ?? acc.endpoint;
  const url = buildDashScopeUrl(probeBase, '/tasks/test-connection-probe');
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
      return { ok: true, status: res.statusCode };
    }
    if (code === 'InvalidApiKey') {
      return {
        ok: false,
        status: res.statusCode,
        code,
        message,
        hint:
          '可能原因：Key 与 endpoint 地域不匹配（北京 Key 不能用于新加坡站，反之亦然），或 Key 已吊销 / 没在该地域开通。请检查 accounts.yaml',
      };
    }
    if (
      res.statusCode === 404 ||
      /not found|UNKNOWN|invalid task/i.test(message ?? '') ||
      code === 'InvalidParameter'
    ) {
      return { ok: true, status: res.statusCode, code, message: '认证通过' };
    }
    return { ok: false, status: res.statusCode, code, message };
  } catch (e) {
    return { ok: false, message: (e as Error).message, hint: '网络错误或 endpoint 不可达' };
  }
}
