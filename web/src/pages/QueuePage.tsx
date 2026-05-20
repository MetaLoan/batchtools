import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Empty, Progress, App as AntApp, Button } from 'antd';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelative } from '../lib/format';

export default function QueuePage() {
  const qc = useQueryClient();
  const { message } = AntApp.useApp();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs().then((r) => r.jobs),
    refetchInterval: 5000,
  });

  const active = jobs.filter((j) => j.status === 'RUNNING' || j.status === 'QUEUED');

  const cancelMut = useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      message.success('已取消');
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">队列中心</h1>
      <p className="mb-6 text-sm text-zinc-500">当前账户的活跃 Job ({active.length})</p>

      {isLoading ? (
        <div className="text-zinc-500">加载中…</div>
      ) : active.length === 0 ? (
        <Empty description="队列空闲" />
      ) : (
        <div className="space-y-3">
          {active.map((j) => {
            const progress =
              j.totalSubJobs === 0
                ? 0
                : Math.round((100 * (j.doneCount + j.failedCount)) / j.totalSubJobs);
            return (
              <div key={j.id} className="surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/tasks/${j.id}`} className="font-mono text-sm text-brand-300 hover:underline">
                        {j.id.slice(0, 8)}
                      </Link>
                      <StatusBadge status={j.status} kind="job" />
                      <span className="text-xs text-zinc-500">{j.capabilityId}</span>
                    </div>
                    <div className="mt-1 truncate text-sm text-zinc-400">
                      {j.basePrompt ?? <span className="text-zinc-600">(无 prompt)</span>}
                    </div>
                    <div className="mt-2">
                      <Progress
                        percent={progress}
                        showInfo={false}
                        strokeColor="#6366f1"
                        trailColor="#27272a"
                        size="small"
                      />
                      <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                        <span>
                          {j.doneCount + j.failedCount}/{j.totalSubJobs} 子任务 · {formatRelative(j.createdAt)}
                        </span>
                        <span>{progress}%</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<X size={14} />}
                    onClick={() => cancelMut.mutate(j.id)}
                    loading={cancelMut.isPending}
                  >
                    取消
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
