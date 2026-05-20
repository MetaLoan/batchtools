import type { IProvider, SubmitRequest, ProviderContext, ProviderHandle, PollResult, MediaInput } from '@bvp/shared';
import { wan27I2VCapability } from './capabilities.js';
import { submitAsyncVideo, pollAsyncVideo } from './wan-video-shared.js';

const KIND_TO_DASHSCOPE_TYPE: Partial<Record<MediaInput['kind'], string>> = {
  first_frame: 'first_frame',
  last_frame: 'last_frame',
  first_clip: 'first_clip',
  driving_audio: 'driving_audio',
};

export const wan27I2VProvider: IProvider = {
  capability: wan27I2VCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const media = req.media
      .map((m) => {
        const type = KIND_TO_DASHSCOPE_TYPE[m.kind];
        return type ? { type, url: m.url } : null;
      })
      .filter((x): x is { type: string; url: string } => x !== null);

    if (media.length === 0) {
      throw new Error('Wan 2.7 I2V requires at least one media item (first_frame / first_clip)');
    }

    const body = {
      model: req.modelVariant,
      input: {
        prompt: req.prompt ?? '',
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        media,
      },
      parameters: {
        ...req.parameters,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
    };
    return submitAsyncVideo(body, ctx);
  },

  async poll(handle: ProviderHandle, ctx: ProviderContext): Promise<PollResult> {
    return pollAsyncVideo(handle, ctx);
  },
};
