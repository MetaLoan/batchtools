import type {
  AccountSummary,
  Capability,
  CapabilityId,
  JobDetail,
  JobSummary,
  MediaInput,
  SubJobDetail,
  BatchMatrix,
} from '@bvp/shared';

async function http<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) throw new ApiError('Unauthorized', 401);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body as { error?: unknown })?.error && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

export const api = {
  // Auth
  login: (password: string) => http<{ ok: true }>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => http<{ ok: true }>('/v1/auth/logout', { method: 'POST' }),
  me: () => http<{ authenticated: boolean }>('/v1/auth/me'),

  // Capabilities
  listCapabilities: () => http<{ capabilities: Capability[] }>('/v1/capabilities'),

  // Accounts
  listAccounts: () => http<{ accounts: AccountSummary[] }>('/v1/accounts'),
  createAccount: (input: {
    name: string;
    apiKey: string;
    endpoint?: string;
    disableDataInspection?: boolean;
  }) => http<AccountSummary>('/v1/accounts', { method: 'POST', body: JSON.stringify(input) }),
  deleteAccount: (id: string) => http<{ ok: true }>(`/v1/accounts/${id}`, { method: 'DELETE' }),
  updateAccount: (id: string, patch: Partial<{ name: string; apiKey: string; disableDataInspection: boolean }>) =>
    http<AccountSummary>(`/v1/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Jobs
  createJob: (input: {
    accountId: string;
    capabilityId: CapabilityId;
    modelVariant: string;
    basePrompt?: string;
    baseNegativePrompt?: string;
    baseMedia: MediaInput[];
    baseParameters: Record<string, unknown>;
    batchMatrix: BatchMatrix;
  }) => http<{ jobId: string; total: number }>('/v1/jobs', { method: 'POST', body: JSON.stringify(input) }),
  listJobs: (accountId: string, limit = 50) =>
    http<{ jobs: JobSummary[] }>(`/v1/jobs?accountId=${encodeURIComponent(accountId)}&limit=${limit}`),
  getJob: (accountId: string, jobId: string) =>
    http<{ job: JobDetail; subJobs: SubJobDetail[] }>(
      `/v1/jobs/${jobId}?accountId=${encodeURIComponent(accountId)}`
    ),
  cancelJob: (accountId: string, jobId: string) =>
    http<{ canceled: number }>(`/v1/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  retrySubJob: (accountId: string, subJobId: string, paramOverride?: Record<string, unknown>) =>
    http<{ subJobId: string }>(`/v1/sub_jobs/${subJobId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ accountId, paramOverride }),
    }),

  // Uploads
  uploadFile: async (accountId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/v1/uploads?accountId=${encodeURIComponent(accountId)}`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new ApiError(t || `HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as {
      id: string;
      publicUrl: string;
      expiresAt: number;
      bytes: number;
      filename: string;
      mime: string;
    };
  },
  listUploads: (accountId: string) =>
    http<{
      uploads: Array<{
        id: string;
        filename: string;
        mime: string;
        bytes: number;
        publicUrl: string;
        createdAt: number;
        expiresAt: number;
      }>;
    }>(`/v1/uploads?accountId=${encodeURIComponent(accountId)}`),
};
