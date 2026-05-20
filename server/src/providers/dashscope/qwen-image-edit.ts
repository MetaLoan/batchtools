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
import { dashScopePost } from './base-client.js';

interface QwenEditResponse {
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
const URL_TTL_HOURS = 24;

const syntheticCache = new Map<string, PollResult>();

function expiresAt(): string {
  return new Date(Date.now() + URL_TTL_HOURS * 3600 * 1000).toISOString();
}

export const qwenImageEditProvider: IProvider = {
  capability: qwenImageEditCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    // Qwen image-edit messages.content interleaves images then a single text instruction.
    const sourceImages = req.media.filter((m) => m.kind === 'source_image');
    if (sourceImages.length === 0) {
      throw new Error('Qwen Image Edit 需要至少 1 张源图片');
    }
    if (sourceImages.length > 3) {
      throw new Error('Qwen Image Edit 最多支持 3 张源图片');
    }

    const content: Array<{ image?: string; text?: string }> = sourceImages.map((m) => ({ image: m.url }));
    content.push({ text: req.prompt ?? '' });

    const body = {
      model: req.modelVariant,
      input: {
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      },
      parameters: {
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        ...req.parameters,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
    };

    const resp = await dashScopePost<QwenEditResponse>(SYNC_PATH, body, ctx);
    const images = resp.output?.choices?.[0]?.message?.content ?? [];
    const resultUrls: ResultAsset[] = images
      .map((c) => c.image)
      .filter((u): u is string => typeof u === 'string')
      .map((url) => ({ kind: 'image' as const, url, expiresAt: expiresAt() }));

    const fakeId = `qwen-edit-${nanoid()}`;
    syntheticCache.set(fakeId, { status: 'SUCCEEDED', resultUrls });
    setTimeout(() => syntheticCache.delete(fakeId), 5 * 60_000);

    return {
      providerTaskId: fakeId,
      isSynthetic: true,
      submittedAt: new Date().toISOString(),
      rawSubmitResponse: resp,
    };
  },

  async poll(handle: ProviderHandle): Promise<PollResult> {
    return (
      syntheticCache.get(handle.providerTaskId) ?? {
        status: 'SUCCEEDED',
        resultUrls: [],
      }
    );
  },
};
