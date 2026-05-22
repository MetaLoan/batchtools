import type { IProvider, SubmitRequest, ProviderContext, ProviderHandle, PollResult } from '@bvp/shared';
import { wan26I2VCapability } from './capabilities.js';
import { submitAsyncVideo, pollAsyncVideo } from './wan-video-shared.js';
import { formatParameters } from './base-client.js';

export const wan26I2VProvider: IProvider = {
  capability: wan26I2VCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const firstFrame = req.media.find((m) => m.kind === 'first_frame');
    if (!firstFrame) throw new Error('Wan 2.6 I2V requires a first_frame image');
    const audio = req.media.find((m) => m.kind === 'driving_audio');
    const body = {
      model: req.modelVariant,
      input: {
        ...(req.prompt ? { prompt: req.prompt } : {}),
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        img_url: firstFrame.url,
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
