import { nanoid } from 'nanoid';
import type {
  IProvider,
  ProviderContext,
  ProviderHandle,
  PollResult,
  SubmitRequest,
  ResultAsset,
} from '@bvp/shared';
import { qwenT2ICapability } from './capabilities.js';
import { dashScopePost } from './base-client.js';

interface QwenSyncResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string }>;
      };
    }>;
  };
  request_id?: string;
}

const SYNC_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const QWEN_URL_TTL_HOURS = 24;

const syntheticCache = new Map<string, PollResult>();

function expiresAt(): string {
  return new Date(Date.now() + QWEN_URL_TTL_HOURS * 3600 * 1000).toISOString();
}

export const qwenT2IProvider: IProvider = {
  capability: qwenT2ICapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const body = {
      model: req.modelVariant,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: req.prompt ?? '' }],
          },
        ],
      },
      parameters: {
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        ...req.parameters,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
    };

    const resp = await dashScopePost<QwenSyncResponse>(SYNC_PATH, body, ctx);
    const images = resp.output?.choices?.[0]?.message?.content ?? [];
    const resultUrls: ResultAsset[] = images
      .map((c) => c.image)
      .filter((u): u is string => typeof u === 'string')
      .map((url) => ({ kind: 'image' as const, url, expiresAt: expiresAt() }));

    const fakeId = `qwen-sync-${nanoid()}`;
    syntheticCache.set(fakeId, {
      status: 'SUCCEEDED',
      resultUrls,
    });
    setTimeout(() => syntheticCache.delete(fakeId), 5 * 60_000);

    return {
      providerTaskId: fakeId,
      isSynthetic: true,
      submittedAt: new Date().toISOString(),
      rawSubmitResponse: resp,
    };
  },

  async poll(handle: ProviderHandle): Promise<PollResult> {
    const cached = syntheticCache.get(handle.providerTaskId);
    if (cached) return cached;
    return {
      status: 'SUCCEEDED',
      resultUrls: [],
    };
  },
};
