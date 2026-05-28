import type { CapabilityId, MediaInput } from './capability.js';
import type { JobStatus, SubJobStatus, ProviderTaskStatus } from './status.js';
import type { ResultAsset } from './provider.js';

export interface BatchAxisValue {
  label: string;
  paramOverrides?: Record<string, unknown>;
  promptOverride?: string;
  negativePromptOverride?: string;
  mediaOverride?: MediaInput[];
}

export interface BatchAxis {
  name: string;
  values: BatchAxisValue[];
}

export interface BatchOverride {
  paramOverrides?: Record<string, unknown>;
  promptOverride?: string;
  negativePromptOverride?: string;
}

export interface BatchMatrix {
  axes: BatchAxis[];
  overrides?: Record<number, BatchOverride>;
}

export interface JobSummary {
  id: string;
  accountId: string;
  capabilityId: CapabilityId;
  modelVariant: string;
  status: JobStatus;
  totalSubJobs: number;
  doneCount: number;
  failedCount: number;
  priority: number;
  createdAt: number;
  finishedAt?: number;
  basePrompt?: string;
  folderId?: string | null;
  previewUrl?: string | null;
}

export interface JobDetail extends JobSummary {
  baseNegativePrompt?: string;
  baseMedia: MediaInput[];
  baseParameters: Record<string, unknown>;
  batchMatrix: BatchMatrix;
}

export interface SubJobSummary {
  id: string;
  jobId: string;
  accountId: string;
  capabilityId: CapabilityId;
  indexInJob: number;
  axes: Record<string, unknown>;
  status: SubJobStatus;
  providerTaskId?: string;
  attempts: number;
  resultUrls?: ResultAsset[];
  errorCode?: string;
  errorMessage?: string;
  submittedAt?: number;
  finishedAt?: number;
}

export interface SubJobDetail extends SubJobSummary {
  paramsSnapshot: {
    prompt?: string;
    negativePrompt?: string;
    media: MediaInput[];
    params: Record<string, unknown>;
    model: string;
  };
  origPrompt?: string;
  actualPrompt?: string;
  pollNextAt?: number;
  originSubJobId?: string;
  version: number;
}

export interface AccountSummary {
  id: string;
  name: string;
  endpoint: string;
  queryEndpoint?: string;
  disableDataInspection: boolean;
  policy: AccountPolicy;
  createdAt: number;
}

export interface AccountPolicy {
  maxConcurrentRunning: number;
  submitRatePerMin: number;
  fairShareWeight: number;
  retry: {
    maxAttempts: number;
    backoffSec: number[];
  };
}

export const DEFAULT_ACCOUNT_POLICY: AccountPolicy = {
  maxConcurrentRunning: 8,
  submitRatePerMin: 30,
  fairShareWeight: 1,
  retry: {
    maxAttempts: 3,
    backoffSec: [10, 30, 90],
  },
};

export type SseEventType =
  | 'job.created'
  | 'job.updated'
  | 'sub_job.submitted'
  | 'sub_job.updated'
  | 'sub_job.finished'
  | 'copycat_strategy.log_updated';

export interface SseEvent<T = unknown> {
  type: SseEventType;
  userId: string;
  payload: T;
  ts: number;
}
