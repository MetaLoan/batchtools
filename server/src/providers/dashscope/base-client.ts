import { request } from 'undici';
import fs from 'node:fs';
import { getUploadDetails } from '../../services/upload-service.js';
import { config, isProd } from '../../config.js';
import type { ProviderContext, ProviderTaskStatus, ResultAsset } from '@bvp/shared';

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

/**
 * Combine endpoint + path with smart prefixing:
 *  - aliyuncs.com hosts: auto-prepend /api/v1 if missing
 *  - everything else (proxies): use endpoint verbatim
 */
export function buildDashScopeUrl(endpoint: string, path: string): string {
  const clean = endpoint.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  let host = '';
  try {
    host = new URL(clean).hostname;
  } catch {
    return clean + p;
  }
  if (/aliyuncs\.com$/i.test(host) && !/\/api\/v\d+$/.test(clean)) {
    return clean + '/api/v1' + p;
  }
  return clean + p;
}

export async function dashScopePost<T = unknown>(
  path: string,
  body: unknown,
  ctx: ProviderContext,
  opts: { async?: boolean } = {}
): Promise<T> {
  let finalBody = body;
  if (body && typeof body === 'object') {
    finalBody = await resolveLocalMediaForEnvironment(body);
  }

  const url = buildDashScopeUrl(ctx.endpoint, path);
  const res = await request(url, {
    method: 'POST',
    headers: buildHeaders(ctx, opts),
    body: JSON.stringify(finalBody),
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

/**
 * Extract a stable task identifier from a submit response.
 *  - Sprize-style proxy: top-level `request_id`
 *  - Official DashScope async: `output.task_id`
 *  - Official DashScope sync (Qwen image gen): no task id — provider should
 *    return synthetic handle in that case
 */
export function extractTaskId(resp: unknown): string | undefined {
  if (!resp || typeof resp !== 'object') return undefined;
  const o = resp as Record<string, unknown>;
  if (o.output && typeof o.output === 'object') {
    const out = o.output as Record<string, unknown>;
    if (typeof out.task_id === 'string') return out.task_id;
  }
  if (typeof o.request_id === 'string') return o.request_id;
  return undefined;
}

/**
 * Poll a task by id using the per-account queryEndpoint (falling back to endpoint).
 * Path: `/tasks/{taskId}`.
 */
async function getTask(taskId: string, ctx: ProviderContext): Promise<unknown> {
  const base = ctx.queryEndpoint ?? ctx.endpoint;
  const url = buildDashScopeUrl(base, '/tasks/' + encodeURIComponent(taskId));
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
  return parsed;
}

const STATUS_ACTIVE = new Set(['PENDING', 'PROCESSING', 'RUNNING']);
const STATUS_TERMINAL_OK = new Set(['SUCCEEDED', 'SUCCESS']);
const STATUS_TERMINAL_FAIL = new Set(['FAILED']);
const STATUS_TERMINAL_CANCEL = new Set(['CANCELED', 'CANCELLED']);
const STATUS_LOST = new Set(['UNKNOWN', 'EXPIRED', 'NOT_FOUND']);

/** Normalize the assortment of status strings the various backends emit. */
export function normalizeStatus(raw: string | undefined): ProviderTaskStatus {
  const s = (raw ?? '').toUpperCase();
  if (STATUS_TERMINAL_OK.has(s)) return 'SUCCEEDED';
  if (STATUS_TERMINAL_FAIL.has(s)) return 'FAILED';
  if (STATUS_TERMINAL_CANCEL.has(s)) return 'CANCELED';
  if (STATUS_LOST.has(s)) return 'UNKNOWN';
  if (s === 'PROCESSING' || s === 'RUNNING') return 'RUNNING';
  if (STATUS_ACTIVE.has(s)) return 'PENDING';
  return 'PENDING';
}

/**
 * Extract result URLs from a polled task response. Tolerates 5+ shapes:
 *  1. top-level `urls[]`
 *  2. `output.urls[]`
 *  3. `output.result_urls[]`
 *  4. `output.video_url` (single)
 *  5. `output.choices[].message.content[].image` (OpenAI-style)
 *  6. `output.results[].url` (DashScope qwen async)
 */
export function extractResultAssets(resp: unknown): ResultAsset[] {
  const urls: { kind: 'image' | 'video'; url: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string | undefined | null, fallbackKind?: 'image' | 'video') => {
    if (!url || typeof url !== 'string' || seen.has(url)) return;
    seen.add(url);
    const lower = url.toLowerCase();
    const kind: 'image' | 'video' =
      fallbackKind ?? (/\.(mp4|mov|webm)(\?|$)/.test(lower) ? 'video' : 'image');
    urls.push({ kind, url });
  };

  if (!resp || typeof resp !== 'object') return [];
  const o = resp as Record<string, unknown>;

  // (1) top-level urls
  if (Array.isArray(o.urls)) for (const u of o.urls) push(u as string);

  const out = o.output && typeof o.output === 'object' ? (o.output as Record<string, unknown>) : null;
  if (out) {
    // (2) output.urls
    if (Array.isArray(out.urls)) for (const u of out.urls) push(u as string);
    // (3) output.result_urls
    if (Array.isArray(out.result_urls)) for (const u of out.result_urls) push(u as string);
    // (4) output.video_url
    if (typeof out.video_url === 'string') push(out.video_url, 'video');
    // (5) output.choices[].message.content[].image
    if (Array.isArray(out.choices)) {
      for (const ch of out.choices as Array<Record<string, unknown>>) {
        const msg = (ch.message ?? {}) as Record<string, unknown>;
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const c of content as Array<Record<string, unknown>>) {
            if (typeof c.image === 'string') push(c.image, 'image');
            if (typeof c.video === 'string') push(c.video, 'video');
          }
        }
      }
    }
    // (6) output.results[].url
    if (Array.isArray(out.results)) {
      for (const r of out.results as Array<Record<string, unknown>>) {
        if (typeof r.url === 'string') push(r.url);
      }
    }
  }

  const ttl = 24 * 3600 * 1000;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  return urls.map((u) => ({ ...u, expiresAt }));
}

export interface PolledTask {
  status: ProviderTaskStatus;
  resultUrls: ResultAsset[];
  errorCode?: string;
  errorMessage?: string;
  origPrompt?: string;
  actualPrompt?: string;
  raw: unknown;
}

export async function pollTask(taskId: string, ctx: ProviderContext): Promise<PolledTask> {
  const raw = await getTask(taskId, ctx);
  const o = (raw as Record<string, unknown>) ?? {};
  const out = (o.output && typeof o.output === 'object'
    ? (o.output as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const status = normalizeStatus(
    (typeof out.task_status === 'string' && out.task_status) ||
      (typeof o.status === 'string' && o.status) ||
      undefined
  );

  const errorCode = (out.code as string | undefined) ?? (o.code as string | undefined);
  const errorMessage =
    (out.message as string | undefined) ??
    (o.message as string | undefined) ??
    (o.error_message as string | undefined);

  return {
    status,
    resultUrls: status === 'SUCCEEDED' ? extractResultAssets(raw) : [],
    errorCode,
    errorMessage,
    origPrompt: out.orig_prompt as string | undefined,
    actualPrompt: out.actual_prompt as string | undefined,
    raw,
  };
}

function extractMessage(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (typeof o.message === 'string') return o.message;
  if (typeof o.error_message === 'string') return o.error_message;
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

export function formatParameters(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('parameters.')) {
      result[k.substring(11)] = v;
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * 自动将本地上传的图片转换为 Base64 Data URL 格式
 */
async function convertLocalFileToBase64DataUrl(localPath: string, mimeType: string): Promise<string> {
  const fileBuffer = fs.readFileSync(localPath);
  const base64Data = fileBuffer.toString('base64');
  return `data:${mimeType};base64,${base64Data}`;
}

/**
 * 根据运行环境自动处理本地上传的 URL 资源。
 * - 生产环境（Fly.io）且配置了公网域名时：直接保持公网 URL 原样发送，让网关/百炼通过网络拉取，防止 Base64 数据过大。
 * - 本地开发环境（config.publicHost 包含 localhost/127.0.0.1 时）：自动转换为 Base64 格式发送以避开连通性报错。
 */
export async function resolveLocalMediaForEnvironment(body: any): Promise<any> {
  const isLocalHost = config.publicHost.includes('localhost') || config.publicHost.includes('127.0.0.1');
  if (isProd && !isLocalHost) {
    // 生产环境且不是 localhost 宿主，直接保留原样公网 URL，百炼可以直接拉取，不需要转 base64
    return body;
  }

  if (!body) return body;

  const processValue = async (val: any): Promise<any> => {
    if (typeof val === 'string') {
      const match = val.match(/\/uploads\/([^/]+)\/([^?#]+)/);
      if (match) {
        const userId = match[1];
        const rawFilename = match[2];
        const id = rawFilename.split('.')[0];
        
        const details = getUploadDetails(userId, id);
        if (details && fs.existsSync(details.storagePath)) {
          return await convertLocalFileToBase64DataUrl(details.storagePath, details.mime);
        }
      }
      return val;
    }

    if (Array.isArray(val)) {
      const arr = [];
      for (const item of val) {
        arr.push(await processValue(item));
      }
      return arr;
    }

    if (val && typeof val === 'object') {
      const obj: any = {};
      for (const [k, v] of Object.entries(val)) {
        obj[k] = await processValue(v);
      }
      return obj;
    }

    return val;
  };

  return processValue(body);
}

