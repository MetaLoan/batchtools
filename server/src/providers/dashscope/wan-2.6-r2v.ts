import type { IProvider, SubmitRequest, ProviderContext, ProviderHandle, PollResult } from '@bvp/shared';
import { wan26R2VCapability } from './capabilities.js';
import { submitAsyncVideo, pollAsyncVideo } from './wan-video-shared.js';
import { formatParameters } from './base-client.js';

export const wan26R2VProvider: IProvider = {
  capability: wan26R2VCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    // images first then videos, preserving user ordering for character1..N mapping
    const images = req.media.filter((m) => m.kind === 'reference_image').map((m) => m.url);
    const videos = req.media.filter((m) => m.kind === 'reference_video').map((m) => m.url);
    const referenceUrls = [...images, ...videos];

    if (referenceUrls.length === 0) {
      throw new Error('Wan 2.6 R2V requires at least one reference image or video');
    }

    const body = {
      model: req.modelVariant,
      input: {
        prompt: req.prompt ?? '',
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        reference_urls: referenceUrls,
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
