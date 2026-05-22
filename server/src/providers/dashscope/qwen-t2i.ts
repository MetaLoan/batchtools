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
import { dashScopePost, extractTaskId, pollTask, extractResultAssets, formatParameters } from './base-client.js';

const SYNC_PATH = '/services/aigc/multimodal-generation/generation';
const URL_TTL_HOURS = 24;

const syntheticCache = new Map<string, PollResult>();

function expiresAt(): string {
  return new Date(Date.now() + URL_TTL_HOURS * 3600 * 1000).toISOString();
}

export const qwenT2IProvider: IProvider = {
  capability: qwenT2ICapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const body = {
      model: req.modelVariant,
      input: {
        messages: [{ role: 'user', content: [{ text: req.prompt ?? '' }] }],
      },
      parameters: {
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        ...formatParameters(req.parameters),
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
    };

    const resp = await dashScopePost<unknown>(SYNC_PATH, body, ctx);

    // (A) Sync response (official DashScope) — image already in output.choices[].message.content[].image
    const sync = extractResultAssets(resp);
    if (sync.length > 0) {
      const resultUrls: ResultAsset[] = sync.map((r) => ({ ...r, expiresAt: expiresAt() }));
      const fakeId = `qwen-sync-${nanoid()}`;
      syntheticCache.set(fakeId, { status: 'SUCCEEDED', resultUrls });
      setTimeout(() => syntheticCache.delete(fakeId), 5 * 60_000);
      return {
        providerTaskId: fakeId,
        isSynthetic: true,
        submittedAt: new Date().toISOString(),
        rawSubmitResponse: resp,
      };
    }

    // (B) Async response (proxy/sprize) — has request_id + status: PENDING; poll later
    const taskId = extractTaskId(resp);
    if (!taskId) {
      throw new Error('Qwen T2I: no result and no task id in response');
    }
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
