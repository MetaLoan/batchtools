import clsx from 'clsx';
import type { SubJobStatus, JobStatus } from '@bvp/shared';

const SUB_JOB_LABEL: Record<SubJobStatus, { label: string; cls: string }> = {
  PENDING_SUBMIT: { label: '排队中', cls: 'bg-zinc-500/15 text-zinc-300' },
  SUBMITTED: { label: '已提交', cls: 'bg-sky-500/15 text-sky-300' },
  RUNNING: { label: '生成中', cls: 'bg-brand-500/20 text-brand-300 animate-pulse-slow' },
  SUCCEEDED: { label: '已完成', cls: 'bg-emerald-500/15 text-emerald-300' },
  SUCCEEDED_EXPIRED: { label: '已过期', cls: 'bg-amber-500/15 text-amber-300' },
  FAILED: { label: '失败', cls: 'bg-rose-500/15 text-rose-300' },
  RETRY_QUEUED: { label: '重试中', cls: 'bg-amber-500/15 text-amber-300' },
  DEAD: { label: '终止', cls: 'bg-rose-500/15 text-rose-300' },
  CANCELING: { label: '取消中', cls: 'bg-zinc-500/15 text-zinc-300' },
  CANCELED: { label: '已取消', cls: 'bg-zinc-500/15 text-zinc-400' },
  CANCELED_BUT_DELIVERED: { label: '取消已交付', cls: 'bg-amber-500/15 text-amber-300' },
  LOST: { label: '已丢失', cls: 'bg-zinc-500/15 text-zinc-400' },
  INVALID: { label: '参数无效', cls: 'bg-rose-500/15 text-rose-300' },
  BLOCKED_NO_CREDIT: { label: '配额不足', cls: 'bg-amber-500/15 text-amber-300' },
};

const JOB_LABEL: Record<JobStatus, { label: string; cls: string }> = {
  DRAFT: { label: '草稿', cls: 'bg-zinc-500/15 text-zinc-400' },
  QUEUED: { label: '排队', cls: 'bg-zinc-500/15 text-zinc-300' },
  RUNNING: { label: '运行', cls: 'bg-brand-500/15 text-brand-300' },
  PARTIAL_SUCCESS: { label: '部分成功', cls: 'bg-amber-500/15 text-amber-300' },
  SUCCEEDED: { label: '成功', cls: 'bg-emerald-500/15 text-emerald-300' },
  FAILED: { label: '失败', cls: 'bg-rose-500/15 text-rose-300' },
  CANCELED: { label: '已取消', cls: 'bg-zinc-500/15 text-zinc-400' },
};

export function StatusBadge({ status, kind = 'sub' }: { status: SubJobStatus | JobStatus; kind?: 'sub' | 'job' }) {
  const map = kind === 'job' ? JOB_LABEL : SUB_JOB_LABEL;
  const info = (map as Record<string, { label: string; cls: string }>)[status] ?? {
    label: status,
    cls: 'bg-zinc-500/15 text-zinc-400',
  };
  return (
    <span className={clsx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', info.cls)}>
      {info.label}
    </span>
  );
}
