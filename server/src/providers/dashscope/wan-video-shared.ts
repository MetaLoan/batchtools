import type { PollResult, ProviderContext, ProviderHandle } from '@bvp/shared';
import { dashScopePost, extractTaskId, pollTask } from './base-client.js';

const VIDEO_SYNTHESIS_PATH = '/services/aigc/video-generation/video-synthesis';

export async function submitAsyncVideo(
  body: unknown,
  ctx: ProviderContext
): Promise<ProviderHandle> {
  const resp = await dashScopePost<unknown>(VIDEO_SYNTHESIS_PATH, body, ctx, { async: true });
  const taskId = extractTaskId(resp);
  if (!taskId) {
    throw new Error('Provider did not return a task id (neither output.task_id nor request_id)');
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
  const polled = await pollTask(handle.providerTaskId, ctx);
  return {
    status: polled.status,
    resultUrls: polled.resultUrls.length > 0 ? polled.resultUrls : undefined,
    errorCode: polled.errorCode,
    errorMessage: polled.errorMessage,
    origPrompt: polled.origPrompt,
    actualPrompt: polled.actualPrompt,
  };
}
