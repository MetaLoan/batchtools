import { nanoid } from 'nanoid';
import type {
  IProvider,
  ProviderContext,
  ProviderHandle,
  PollResult,
  SubmitRequest,
  ResultAsset,
} from '@bvp/shared';
import { qwenImageEditCapability } from './capabilities.js';
import { dashScopePost, extractTaskId, pollTask, extractResultAssets, formatParameters } from './base-client.js';

const SYNC_PATH = '/services/aigc/multimodal-generation/generation';
const URL_TTL_HOURS = 24;

const syntheticCache = new Map<string, PollResult>();

function expiresAt(): string {
  return new Date(Date.now() + URL_TTL_HOURS * 3600 * 1000).toISOString();
}

export const qwenImageEditProvider: IProvider = {
  capability: qwenImageEditCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const sourceImages = req.media.filter((m) => m.kind === 'source_image');
    if (sourceImages.length === 0) throw new Error('Qwen Image Edit 需要至少 1 张源图片');
    if (sourceImages.length > 3) throw new Error('Qwen Image Edit 最多支持 3 张源图片');

    const content: Array<{ image?: string; text?: string }> = sourceImages.map((m) => ({
      image: m.url,
    }));
    content.push({ text: req.prompt ?? '' });

    const body = {
      model: req.modelVariant,
      input: { messages: [{ role: 'user', content }] },
      parameters: {
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        ...formatParameters(req.parameters),
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
    };

    const resp = await dashScopePost<unknown>(SYNC_PATH, body, ctx);

    const sync = extractResultAssets(resp);
    if (sync.length > 0) {
      const resultUrls: ResultAsset[] = sync.map((r) => ({ ...r, expiresAt: expiresAt() }));
      const fakeId = `qwen-edit-${nanoid()}`;
      syntheticCache.set(fakeId, { status: 'SUCCEEDED', resultUrls });
      setTimeout(() => syntheticCache.delete(fakeId), 5 * 60_000);
      return {
        providerTaskId: fakeId,
        isSynthetic: true,
        submittedAt: new Date().toISOString(),
        rawSubmitResponse: resp,
      };
    }

    const taskId = extractTaskId(resp);
    if (!taskId) throw new Error('Qwen Image Edit: no result and no task id in response');
    return {
      providerTaskId: taskId,
      isSynthetic: false,
      submittedAt: new Date().toISOString(),
      rawSubmitResponse: resp,
    };
  },

  async poll(handle: ProviderHandle, ctx: ProviderContext): Promise<PollResult> {
    if (handle.isSynthetic) {
      return syntheticCache.get(handle.providerTaskId) ?? { status: 'SUCCEEDED', resultUrls: [] };
    }
    const p = await pollTask(handle.providerTaskId, ctx);
    return {
      status: p.status,
      resultUrls: p.resultUrls.length > 0 ? p.resultUrls : undefined,
      errorCode: p.errorCode,
      errorMessage: p.errorMessage,
      origPrompt: p.origPrompt,
      actualPrompt: p.actualPrompt,
    };
  },
};
