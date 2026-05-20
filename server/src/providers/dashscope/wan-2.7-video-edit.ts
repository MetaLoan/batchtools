import type { IProvider, SubmitRequest, ProviderContext, ProviderHandle, PollResult } from '@bvp/shared';
import { wan27VideoEditCapability } from './capabilities.js';
import { submitAsyncVideo, pollAsyncVideo } from './wan-video-shared.js';

export const wan27VideoEditProvider: IProvider = {
  capability: wan27VideoEditCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const sourceVideo = req.media.find((m) => m.kind === 'source_video');
    if (!sourceVideo) {
      throw new Error('Wan 2.7 视频编辑需要 1 个源视频');
    }
    const referenceImages = req.media.filter((m) => m.kind === 'reference_image');
    if (referenceImages.length > 4) {
      throw new Error('参考图最多 4 张');
    }

    const media: Array<{ type: string; url: string }> = [
      { type: 'video', url: sourceVideo.url },
      ...referenceImages.map((m) => ({ type: 'reference_image' as const, url: m.url })),
    ];

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
