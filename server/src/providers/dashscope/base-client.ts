import { request } from 'undici';
import type { ProviderContext, ProviderTaskStatus, ResultAsset } from '@bvp/shared';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { nanoid } from 'nanoid';
import { config } from '../../config.js';
import { saveUpload } from '../../services/upload-service.js';

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

/**
 * 递归扫描请求体中的所有视频 URL，下载并检测其时长。
 * 如果超出 10.0 秒，则自动在后台拉取、裁剪为 9.95 秒，并上传到自建 S3 中，替换为裁剪后的新 URL。
 */
export async function resolveAndTrimExternalVideos(body: any): Promise<any> {
  if (!body) return body;

  const requestedDuration = Number(body?.parameters?.duration || 10);

  const processValue = async (val: any, isFirstClip = false): Promise<any> => {
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      // 只处理以 http/https 开头且具有视频后缀的公网 URL
      // 同时排除已经是我们自建的 S3 桶域名的链接（除非是 first_clip 需要更短的时长）
      const isHttpVideo = /^(https?:\/\/)/.test(lower) && /\.(mp4|mov|webm)(\?|$)/.test(lower);
      const isTigris = !!(config.s3.bucket && lower.includes(`${config.s3.bucket}.t3.tigrisfiles.io`));
      
      const shouldProcess = isHttpVideo && (!isTigris || isFirstClip);

      if (shouldProcess) {
        const tempDir = os.tmpdir();
        const ext = val.match(/\.(mp4|mov|webm)/i)?.[0] || '.mp4';
        const tempInputPath = path.join(tempDir, `bvp-ext-in-${nanoid()}${ext}`);
        const tempOutputPath = path.join(tempDir, `bvp-ext-out-${nanoid()}${ext}`);

        try {
          console.log(`[video-trim-ext] Checking/downloading external video: ${val} (isFirstClip: ${isFirstClip})`);
          // 1. 下载视频到临时文件
          const res = await request(val, { method: 'GET' });
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const buf = Buffer.from(await res.body.arrayBuffer());
            fs.writeFileSync(tempInputPath, buf);

            // 2. 检测时长
            const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempInputPath}"`;
            const durationStr = execSync(probeCmd, { encoding: 'utf8' }).trim();
            const duration = parseFloat(durationStr);

            const maxAllowed = isFirstClip ? Math.min(9.8, requestedDuration - 0.2) : 10.0;
            const targetDuration = isFirstClip ? maxAllowed : 9.95;

            if (!isNaN(duration) && duration > maxAllowed) {
              console.log(`[video-trim-ext] Video duration is ${duration}s (exceeds limit ${maxAllowed}s). Trimming to ${targetDuration}s...`);
              
              // 3. 执行重新编码裁剪（精确控制时长并保证解码兼容性，规避 AlgoError）
              // 如果是视频续写(isFirstClip)，我们保留结尾画面，砍掉开头的多余时间，确保大模型续写的最后一帧与画面完美衔接
              const startOffset = isFirstClip ? Math.max(0, duration - targetDuration) : 0;
              const trimCmd = `ffmpeg -y -i "${tempInputPath}" -ss ${startOffset} -t ${targetDuration} -c:v libx264 -preset superfast -crf 23 -c:a aac "${tempOutputPath}"`;
              execSync(trimCmd, { stdio: 'ignore' });

              if (fs.existsSync(tempOutputPath)) {
                const trimmedBuf = fs.readFileSync(tempOutputPath);
                
                // 4. 调用 saveUpload 上传至 S3（或本地图床）
                const uploadRes = await saveUpload({
                  userId: 'system-trimmed',
                  filename: `trimmed_${nanoid()}${ext}`,
                  mime: ext === '.mov' ? 'video/quicktime' : 'video/mp4',
                  data: trimmedBuf,
                });
                
                console.log(`[video-trim-ext] Trimmed video uploaded. New URL: ${uploadRes.publicUrl}`);
                return uploadRes.publicUrl;
              }
            } else {
              console.log(`[video-trim-ext] Video duration is ${duration}s (under ${maxAllowed}s limit). No trimming needed.`);
            }
          } else {
            console.warn(`[video-trim-ext] Failed to fetch external video. HTTP status: ${res.statusCode}`);
          }
        } catch (err) {
          console.error(`[video-trim-ext] Error during external video check/trimming for ${val}:`, err);
        } finally {
          try {
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
          } catch {}
        }
      }
      return val;
    }

    if (Array.isArray(val)) {
      const arr = [];
      for (const item of val) {
        arr.push(await processValue(item, isFirstClip));
      }
      return arr;
    }

    if (val && typeof val === 'object') {
      const obj: any = {};
      const isParentFirstClip = val.type === 'first_clip';
      for (const [k, v] of Object.entries(val)) {
        obj[k] = await processValue(v, isParentFirstClip || isFirstClip);
      }
      return obj;
    }

    return val;
  };

  return processValue(body);
}

export async function dashScopePost<T = unknown>(
  path: string,
  body: unknown,
  ctx: ProviderContext,
  opts: { async?: boolean } = {}
): Promise<T> {
  let finalBody = body;
  if (body && typeof body === 'object') {
    finalBody = await resolveAndTrimExternalVideos(body);
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

  return urls.map((u) => ({ ...u }));
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


