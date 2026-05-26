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

export interface CurrentUser {
  id: string;
  username: string;
  isAdmin: boolean;
  displayName?: string;
  createdAt: number;
  lastLoginAt?: number;
}

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
  login: (username: string, password: string) =>
    http<{ ok: true; user: CurrentUser }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => http<{ ok: true }>('/v1/auth/logout', { method: 'POST' }),
  me: () => http<{ authenticated: boolean; user?: CurrentUser }>('/v1/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    http<{ ok: true }>('/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  // Users (admin)
  listUsers: () => http<{ users: CurrentUser[] }>('/v1/users'),
  createUser: (input: { username: string; password: string; displayName?: string; isAdmin?: boolean }) =>
    http<CurrentUser>('/v1/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (id: string, patch: { displayName?: string; isAdmin?: boolean }) =>
    http<CurrentUser>(`/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  resetUserPassword: (id: string, newPassword: string) =>
    http<{ ok: true }>(`/v1/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  deleteUser: (id: string) => http<{ ok: true }>(`/v1/users/${id}`, { method: 'DELETE' }),

  // Capabilities
  listCapabilities: () => http<{ capabilities: Capability[] }>('/v1/capabilities'),

  // DashScope accounts (read-only listing — devops manages keys via accounts.yaml)
  listAccounts: () => http<{ accounts: AccountSummary[] }>('/v1/accounts'),
  testAccount: (id: string) =>
    http<{ ok: boolean; status?: number; code?: string; message?: string; hint?: string }>(
      `/v1/accounts/${id}/test`,
      { method: 'POST' }
    ),

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
  listJobs: (limit = 50) => http<{ jobs: JobSummary[] }>(`/v1/jobs?limit=${limit}`),
  getJob: (jobId: string) =>
    http<{ job: JobDetail; subJobs: SubJobDetail[] }>(`/v1/jobs/${jobId}`),
  cancelJob: (jobId: string) =>
    http<{ canceled: number }>(`/v1/jobs/${jobId}/cancel`, { method: 'POST', body: '{}' }),
  retrySubJob: (subJobId: string, paramOverride?: Record<string, unknown>) =>
    http<{ subJobId: string }>(`/v1/sub_jobs/${subJobId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ paramOverride }),
    }),

  // Uploads (user-scoped)
  uploadFile: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/v1/uploads', {
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
  listUploads: () =>
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
    }>('/v1/uploads'),
  renderVideo: (input: {
    width: number;
    height: number;
    muteOriginal?: boolean;
    audioUrl?: string;
    segments: Array<{
      url: string;
      start: number;
      duration: number;
      crop?: { x: number; y: number; w: number; h: number };
    }>;
  }) => http<{ trimmedUrl: string }>('/v1/editor/render', {
    method: 'POST',
    body: JSON.stringify(input),
  }),

  // Strategies
  listStrategies: () => 
    http<Array<{
      id: string;
      name: string;
      refImageUrl: string;
      persona: string;
      duration: number;
      capabilityId: string;
      modelVariant: string;
      createdAt: number;
    }>>('/v1/strategies'),
  createStrategy: (input: {
    name: string;
    refImageUrl: string;
    persona: string;
    duration: number;
    capabilityId: string;
    modelVariant: string;
  }) => http<any>('/v1/strategies', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  deleteStrategy: (id: string) => 
    http<{ ok: boolean }>(`/v1/strategies/${id}`, { method: 'DELETE' }),
  generateStrategyScripts: (id: string, count: number) =>
    http<{ scripts: Array<{ title: string; prompt: string; duration: number }> }>(
      `/v1/strategies/${id}/generate`,
      { method: 'POST', body: JSON.stringify({ count }) }
    ),
  executeStrategy: (id: string, input: { accountId: string; prompts: Array<{ title: string; prompt: string }> }) =>
    http<{ ok: boolean; jobIds: string[] }>(`/v1/strategies/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
