import { useQuery } from '@tanstack/react-query';
import { Empty, Tabs, App as AntApp } from 'antd';
import { Copy, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes, formatCountdown, formatRelative } from '../lib/format';
import { useCapabilities } from '../App';
import { useAppStore } from '../lib/store';

export default function AssetsPage() {
  const { message } = AntApp.useApp();
  const assetsActiveTab = useAppStore((s) => s.assetsActiveTab);
  const setAssetsActiveTab = useAppStore((s) => s.setAssetsActiveTab);

  const { data: uploadsData } = useQuery({
    queryKey: ['uploads'],
    queryFn: () => api.listUploads().then((r) => r.uploads || []),
    refetchInterval: 10_000,
  });
  const uploads = Array.isArray(uploadsData) ? uploadsData : [];

  const { data: jobsData } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(200).then((r) => r.jobs || []),
  });
  const jobs = Array.isArray(jobsData) ? jobsData : [];

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => message.success('已复制 URL'));
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">素材库</h1>
      <p className="mb-4 text-sm text-zinc-500">临时图床上传与产物输出聚合</p>

      <Tabs
        activeKey={assetsActiveTab}
        onChange={setAssetsActiveTab}
        items={[
          {
            key: 'uploads',
            label: `上传 (${uploads.length})`,
            children:
              uploads.length === 0 ? (
                <Empty description="还未上传过任何素材" />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {uploads.map((u) => (
                    <div key={u.id} className="surface group relative overflow-hidden">
                      {u.mime.startsWith('image/') ? (
                        <img src={u.publicUrl} alt="" className="block aspect-square w-full object-cover" />
                      ) : u.mime.startsWith('video/') ? (
                        <video src={u.publicUrl} className="block aspect-square w-full object-cover" muted />
                      ) : (
                        <div className="flex aspect-square items-center justify-center text-zinc-500">
                          音频
                        </div>
                      )}
                      <div className="p-2">
                        <div className="truncate text-xs">{u.filename}</div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
                          <span>{formatBytes(u.bytes)}</span>
                          {u.expiresAt && u.expiresAt < Date.now() + 10 * 365 * 24 * 3600 * 1000 ? (
                            <span className="flex items-center gap-1">
                              <Clock size={10} /> {formatCountdown(u.expiresAt)}
                            </span>
                          ) : null}
                        </div>
                        <button
                          onClick={() => copy(u.publicUrl)}
                          className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-brand-500/20 hover:text-brand-300"
                        >
                          <Copy size={10} /> 复制 URL
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ),
          },
          {
            key: 'outputs',
            label: '产物输出',
            children: <OutputsTab jobs={jobs} />,
          },
        ]}
      />
    </div>
  );
}

function OutputsTab({ jobs }: { jobs: { id: string; capabilityId: string; createdAt: number }[] }) {
  const { data: capabilities = [] } = useCapabilities();
  if (jobs.length === 0) return <Empty description="尚无任务产物" />;
  return (
    <div className="space-y-2 text-sm">
      {jobs.slice(0, 20).map((j) => (
        <a
          key={j.id}
          href={`/tasks/${j.id}`}
          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 hover:border-brand-500"
        >
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs text-brand-300 truncate inline-block max-w-[280px]" title={j.id}>{j.id}</span>
            <span className="ml-3 text-xs text-zinc-500">
              {capabilities.find((c) => c.id === j.capabilityId)?.shortName ?? j.capabilityId}
            </span>
          </div>
          <span className="text-xs text-zinc-500">{formatRelative(j.createdAt)}</span>
        </a>
      ))}
    </div>
  );
}
