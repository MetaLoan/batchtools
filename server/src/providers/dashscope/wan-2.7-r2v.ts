import type { IProvider, SubmitRequest, ProviderContext, ProviderHandle, PollResult, MediaInput } from '@bvp/shared';
import { wan27R2VCapability } from './capabilities.js';
import { submitAsyncVideo, pollAsyncVideo } from './wan-video-shared.js';

const KIND_TO_DASHSCOPE_TYPE: Partial<Record<MediaInput['kind'], string>> = {
  reference_image: 'reference_image',
  reference_video: 'reference_video',
  first_frame: 'first_frame',
};

export const wan27R2VProvider: IProvider = {
  capability: wan27R2VCapability,

  async submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle> {
    const voiceMap = new Map<string, string>();
    for (const m of req.media) {
      if (m.kind === 'reference_voice' && m.boundTo) voiceMap.set(m.boundTo, m.url);
    }

    const media = req.media
      .filter((m) => m.kind !== 'reference_voice')
      .map((m) => {
        const type = KIND_TO_DASHSCOPE_TYPE[m.kind];
        if (!type) return null;
        const item: Record<string, unknown> = { type, url: m.url };
        if (m.localId && voiceMap.has(m.localId)) item.reference_voice = voiceMap.get(m.localId);
        return item;
      })
      .filter((x): x is Record<string, unknown> => x !== null);

    if (media.length === 0) {
      throw new Error('Wan 2.7 R2V requires at least one reference image or video');
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
