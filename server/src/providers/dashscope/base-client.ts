import { request } from 'undici';
import type { ProviderContext } from '@bvp/shared';

export interface DashScopeError extends Error {
  code?: string;
  status?: number;
  requestId?: string;
}

function buildHeaders(ctx: ProviderContext, opts: { async?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.apiKey}`,
  };
  if (opts.async) headers['X-DashScope-Async'] = 'enable';
  if (ctx.disableDataInspection) {
    headers['X-DashScope-DataInspection'] = JSON.stringify({ input: 'disable', output: 'disable' });
  }
  return headers;
}

export async function dashScopePost<T = unknown>(
  pathname: string,
  body: unknown,
  ctx: ProviderContext,
  opts: { async?: boolean } = {}
): Promise<T> {
  const url = ctx.endpoint.replace(/\/$/, '') + pathname;
  const res = await request(url, {
    method: 'POST',
    headers: buildHeaders(ctx, opts),
    body: JSON.stringify(body),
    signal: ctx.signal,
  });
  const text = await res.body.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { rawText: text };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err: DashScopeError = new Error(extractMessage(parsed) || `HTTP ${res.statusCode}`);
    err.status = res.statusCode;
    err.code = extractCode(parsed);
    err.requestId = extractRequestId(parsed);
    throw err;
  }
  return parsed as T;
}

export async function dashScopeGet<T = unknown>(
  pathname: string,
  ctx: ProviderContext
): Promise<T> {
  const url = ctx.endpoint.replace(/\/$/, '') + pathname;
  const res = await request(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
    signal: ctx.signal,
  });
  const text = await res.body.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { rawText: text };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const err: DashScopeError = new Error(extractMessage(parsed) || `HTTP ${res.statusCode}`);
    err.status = res.statusCode;
    err.code = extractCode(parsed);
    err.requestId = extractRequestId(parsed);
    throw err;
  }
  return parsed as T;
}

function extractMessage(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (typeof o.message === 'string') return o.message;
  if (o.output && typeof o.output === 'object') {
    const out = o.output as Record<string, unknown>;
    if (typeof out.message === 'string') return out.message;
  }
}

function extractCode(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (typeof o.code === 'string') return o.code;
  if (o.output && typeof o.output === 'object') {
    const out = o.output as Record<string, unknown>;
    if (typeof out.code === 'string') return out.code;
  }
}

function extractRequestId(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  return typeof o.request_id === 'string' ? o.request_id : undefined;
}

export interface DashScopeTaskResponse {
  output?: {
    task_id?: string;
    task_status?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
    code?: string;
    message?: string;
    video_url?: string;
    orig_prompt?: string;
    actual_prompt?: string;
    submit_time?: string;
    scheduled_time?: string;
    end_time?: string;
    results?: Array<{ url?: string; orig_prompt?: string; actual_prompt?: string }>;
  };
  usage?: Record<string, unknown>;
  request_id?: string;
  code?: string;
  message?: string;
}

const TASK_PATH = '/api/v1/tasks/';

export async function pollDashScopeTask(
  taskId: string,
  ctx: ProviderContext
): Promise<DashScopeTaskResponse> {
  return dashScopeGet<DashScopeTaskResponse>(TASK_PATH + taskId, ctx);
}
