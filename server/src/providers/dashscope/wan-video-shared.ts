import type { PollResult, ProviderContext, ProviderHandle, ResultAsset } from '@bvp/shared';
import { dashScopePost, pollDashScopeTask } from './base-client.js';

const VIDEO_SYNTHESIS_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
const DASHSCOPE_VIDEO_TTL_HOURS = 24;

interface AsyncCreateResponse {
  output?: { task_id?: string; task_status?: string };
  request_id?: string;
}

export async function submitAsyncVideo(
  body: unknown,
  ctx: ProviderContext
): Promise<ProviderHandle> {
  const resp = await dashScopePost<AsyncCreateResponse>(VIDEO_SYNTHESIS_PATH, body, ctx, {
    async: true,
  });
  const taskId = resp.output?.task_id;
  if (!taskId) {
    throw new Error('DashScope did not return task_id');
  }
  return {
    providerTaskId: taskId,
    isSynthetic: false,
    submittedAt: new Date().toISOString(),
    rawSubmitResponse: resp,
  };
}

export async function pollAsyncVideo(
  handle: ProviderHandle,
  ctx: ProviderContext
): Promise<PollResult> {
  const resp = await pollDashScopeTask(handle.providerTaskId, ctx);
  const out = resp.output ?? {};
  const status = (out.task_status ?? 'UNKNOWN') as PollResult['status'];

  if (status === 'SUCCEEDED') {
    const videoUrl = out.video_url;
    const resultUrls: ResultAsset[] = videoUrl
      ? [
          {
            kind: 'video',
            url: videoUrl,
            expiresAt: new Date(Date.now() + DASHSCOPE_VIDEO_TTL_HOURS * 3600 * 1000).toISOString(),
          },
        ]
      : [];
    return {
      status,
      resultUrls,
      origPrompt: out.orig_prompt,
      actualPrompt: out.actual_prompt,
      usage: resp.usage,
    };
  }

  if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
    return {
      status,
      errorCode: out.code,
      errorMessage: out.message,
    };
  }

  return { status };
}
