import type { IProvider, SubmitRequest, ProviderContext, ProviderHandle, PollResult } from '@bvp/shared';
import { wan27T2VCapability } from './capabilities.js';
import { submitAsyncVideo, pollAsyncVideo } from './wan-video-shared.js';
import { formatParameters } from './base-client.js';

export const wan27T2VProvider: IProvider = {
  capability: wan27T2VCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const audio = req.media.find((m) => m.kind === 'driving_audio');
    const body = {
      model: req.modelVariant,
      input: {
        prompt: req.prompt ?? '',
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        ...(audio ? { audio_url: audio.url } : {}),
      },
      parameters: {
        ...formatParameters(req.parameters),
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
    };
    return submitAsyncVideo(body, ctx);
  },

  async poll(handle: ProviderHandle, ctx: ProviderContext): Promise<PollResult> {
    return pollAsyncVideo(handle, ctx);
  },
};
