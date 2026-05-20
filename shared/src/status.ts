export type ProviderTaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'UNKNOWN';

export type SubJobStatus =
  | 'PENDING_SUBMIT'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'SUCCEEDED_EXPIRED'
  | 'FAILED'
  | 'RETRY_QUEUED'
  | 'DEAD'
  | 'CANCELING'
  | 'CANCELED'
  | 'CANCELED_BUT_DELIVERED'
  | 'LOST'
  | 'INVALID'
  | 'BLOCKED_NO_CREDIT';

export type JobStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'RUNNING'
  | 'PARTIAL_SUCCESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';

export const SUB_JOB_TERMINAL_STATUSES: SubJobStatus[] = [
  'SUCCEEDED',
  'SUCCEEDED_EXPIRED',
  'FAILED',
  'DEAD',
  'CANCELED',
  'CANCELED_BUT_DELIVERED',
  'LOST',
  'INVALID',
];

export const SUB_JOB_IN_FLIGHT_STATUSES: SubJobStatus[] = [
  'SUBMITTED',
  'RUNNING',
  'CANCELING',
];
