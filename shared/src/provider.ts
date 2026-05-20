import type { CapabilityId, MediaInput, Capability } from './capability.js';
import type { ProviderTaskStatus } from './status.js';

export interface SubmitRequest {
  capabilityId: CapabilityId;
  modelVariant: string;
  prompt?: string;
  negativePrompt?: string;
  media: MediaInput[];
  parameters: Record<string, unknown>;
  seed?: number;
}

export interface ProviderHandle {
  providerTaskId: string;
  isSynthetic: boolean;
  submittedAt: string;
  rawSubmitResponse?: unknown;
}

export interface ResultAsset {
  kind: 'image' | 'video';
  url: string;
  expiresAt: string;
  width?: number;
  height?: number;
  mime?: string;
}

export interface PollResult {
  status: ProviderTaskStatus;
  resultUrls?: ResultAsset[];
  errorCode?: string;
  errorMessage?: string;
  origPrompt?: string;
  actualPrompt?: string;
  usage?: Record<string, unknown>;
}

export interface ProviderContext {
  apiKey: string;
  endpoint: string;
  /**
   * Separate base URL for task polling. Some proxies (e.g. sprize) accept
   * submits under one prefix (.../proxy/dashscope-v2/services/...) but expose
   * the result-fetch endpoint under a sibling prefix (.../proxy/tasks/{id}).
   * When undefined, the poller uses `endpoint` (official DashScope behavior).
   */
  queryEndpoint?: string;
  accountId: string;
  requestId: string;
  disableDataInspection?: boolean;
  signal?: AbortSignal;
}

export interface IProvider {
  readonly capability: Capability;
  submit(req: SubmitRequest, ctx: ProviderContext): Promise<ProviderHandle>;
  poll(handle: ProviderHandle, ctx: ProviderContext): Promise<PollResult>;
  cancel?(handle: ProviderHandle, ctx: ProviderContext): Promise<void>;
}

/** Default DashScope endpoint — sprize.ai proxy that aggregates DashScope international + others. */
export const DASHSCOPE_DEFAULT_ENDPOINT = 'https://ai.sprize.ai/proxy/dashscope-v2';

/** Direct DashScope endpoints (kept as named constants for clarity). */
export const DASHSCOPE_SG_ENDPOINT = 'https://dashscope-intl.aliyuncs.com';
export const DASHSCOPE_CN_ENDPOINT = 'https://dashscope.aliyuncs.com';
export const DASHSCOPE_US_ENDPOINT = 'https://dashscope-us.aliyuncs.com';
