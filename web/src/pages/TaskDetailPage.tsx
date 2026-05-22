import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Empty, App as AntApp, Button, Descriptions, Tooltip } from 'antd';
import { ArrowLeft, RotateCcw, Download, X } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import PreviewWithExpiry from '../components/PreviewWithExpiry';
import { formatRelative } from '../lib/format';
import { explainProviderError } from '../lib/error-hints';

export default function TaskDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const qc = useQueryClient();
  const { message, modal } = AntApp.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 3000,
  });

  const retryMut = useMutation({
    mutationFn: (subJobId: string) => api.retrySubJob(subJobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      message.success('已重新提交');
    },
    onError: (e: Error) => message.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: () => api.cancelJob(jobId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      message.success('已取消');
    },
  });

  if (isLoading) return <div className="p-6 text-zinc-500">加载中…</div>;
  if (!data) return <div className="p-6"><Empty description="任务不存在" /></div>;

  const { job, subJobs } = data;

  function exportScript() {
    const lines: string[] = ['#!/usr/bin/env bash', 'set -e'];
    for (const s of subJobs) {
      if (!s.resultUrls) continue;
      for (const r of s.resultUrls) {
        lines.push(`wget -O "${s.indexInJob}_${r.kind}.${r.kind === 'video' ? 'mp4' : 'png'}" "${r.url}"`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-${job.id.slice(0, 8)}-download.sh`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link to="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-brand-400">
        <ArrowLeft size={14} /> 任务历史
      </Link>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl">{job.id.slice(0, 12)}</h1>
            <StatusBadge status={job.status} kind="job" />
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            {job.capabilityId} · {job.modelVariant} · {formatRelative(job.createdAt)}
          </div>
          {(job.basePrompt || job.baseNegativePrompt) && (
            <div className="mt-3 space-y-2">
              {job.basePrompt && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-300">
                  <span className="text-[10px] text-zinc-500 block mb-0.5 font-mono">BASE PROMPT</span>
                  {job.basePrompt}
                </div>
              )}
              {job.baseNegativePrompt && (
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3 text-sm text-zinc-400">
                  <span className="text-[10px] text-zinc-500 block mb-0.5 font-mono">BASE NEGATIVE PROMPT</span>
                  {job.baseNegativePrompt}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button icon={<Download size={14} />} onClick={exportScript}>
            导出下载脚本
          </Button>
          {(job.status === 'RUNNING' || job.status === 'QUEUED') && (
            <Button danger icon={<X size={14} />} loading={cancelMut.isPending} onClick={() => cancelMut.mutate()}>
              取消任务
            </Button>
          )}
        </div>
      </div>

      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        bordered
        className="!mb-6"
        items={[
          { key: 'total', label: '子任务总数', children: job.totalSubJobs },
          { key: 'done', label: '已完成', children: job.doneCount },
          { key: 'failed', label: '失败/丢失', children: job.failedCount },
        ]}
      />

      <h2 className="mb-3 text-base font-medium text-zinc-200">子任务</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {subJobs.map((s) => (
          <div key={s.id} className="surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-500">#{s.indexInJob}</span>
              <StatusBadge status={s.status} />
            </div>

            {s.resultUrls && s.resultUrls.length > 0 && (
              <div className="space-y-2">
                {s.resultUrls.map((r, i) => (
                  <PreviewWithExpiry key={i} url={r.url} expiresAt={r.expiresAt} kind={r.kind} />
                ))}
              </div>
            )}

            {Object.keys(s.axes).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(s.axes).map(([k, v]) => (
                  <span key={k} className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            )}

            {s.paramsSnapshot?.prompt && (
              <div className="mt-2 text-xs text-zinc-300 bg-zinc-900/40 border border-zinc-800/50 rounded p-2 line-clamp-3 hover:line-clamp-none transition-all cursor-help" title={s.paramsSnapshot.prompt}>
                <span className="text-[10px] text-zinc-500 block mb-0.5 font-mono">PROMPT</span>
                {s.paramsSnapshot.prompt}
              </div>
            )}

            {s.paramsSnapshot?.negativePrompt && (
              <div className="mt-2 text-xs text-zinc-400 bg-zinc-900/20 border border-zinc-800/30 rounded p-2 line-clamp-2 hover:line-clamp-none transition-all cursor-help" title={s.paramsSnapshot.negativePrompt}>
                <span className="text-[10px] text-zinc-500 block mb-0.5 font-mono">NEGATIVE PROMPT</span>
                {s.paramsSnapshot.negativePrompt}
              </div>
            )}

            {s.errorMessage && (() => {
              const exp = explainProviderError(s.errorCode, s.errorMessage);
              return (
                <Tooltip title={`${s.errorCode ?? ''} ${s.errorMessage ?? ''}`.trim()}>
                  <div className="mt-2 rounded bg-rose-500/10 px-2 py-1.5 text-xs text-rose-300">
                    <div className="font-medium">{exp.title}</div>
                    {exp.hints.slice(0, 2).map((h, i) => (
                      <div key={i} className="mt-0.5 text-[11px] opacity-80">
                        · {h}
                      </div>
                    ))}
                  </div>
                </Tooltip>
              );
            })()}

            {(s.status === 'FAILED' ||
              s.status === 'DEAD' ||
              s.status === 'SUCCEEDED_EXPIRED' ||
              s.status === 'LOST') && (
              <Button
                size="small"
                className="mt-2 w-full"
                icon={<RotateCcw size={12} />}
                loading={retryMut.isPending}
                onClick={() =>
                  modal.confirm({
                    title: '重新提交?',
                    content: '将使用相同参数创建新的子任务',
                    onOk: () => retryMut.mutate(s.id),
                  })
                }
              >
                重跑
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
