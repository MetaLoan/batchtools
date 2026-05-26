import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { App as AntApp, Select, Input, Table, Tooltip, Button, Radio, Empty, Card, Spin } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Table as TableIcon, Image as ImageIcon, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelative } from '../lib/format';
import { useCapabilities } from '../App';
import { useAppStore } from '../lib/store';
import PreviewWithExpiry from '../components/PreviewWithExpiry';

export default function TasksPage() {
  const { message } = AntApp.useApp();
  const { data: capabilities = [] } = useCapabilities();
  const navigate = useNavigate();
  const tasksFilter = useAppStore((s) => s.tasksFilter);
  const setTasksFilter = useAppStore((s) => s.setTasksFilter);
  const setAcknowledgedFinishedJobIds = useAppStore((s) => s.setAcknowledgedFinishedJobIds);
  const setCapabilityForm = useAppStore((s) => s.setCapabilityForm);

  const filterCap = tasksFilter.filterCap;
  const filterStatus = tasksFilter.filterStatus;
  const search = tasksFilter.search;

  const setFilterCap = (val: string | undefined) => setTasksFilter({ filterCap: val });
  const setFilterStatus = (val: string | undefined) => setTasksFilter({ filterStatus: val });
  const setSearch = (val: string) => setTasksFilter({ search: val });

  // View state: 'table' or 'media'
  const [viewMode, setViewMode] = useState<'table' | 'media'>('table');

  const { data: jobs = [], isLoading: isJobsLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(200).then((r) => r.jobs),
    refetchInterval: 8000,
  });

  // Query all sub-jobs (completed outputs) for media view
  const { data: subJobsData, isLoading: isSubJobsLoading } = useQuery({
    queryKey: ['sub-jobs'],
    queryFn: () => api.listSubJobs(200),
    enabled: viewMode === 'media',
    refetchInterval: 8000,
  });

  const subJobs = subJobsData?.subJobs || [];

  useEffect(() => {
    if (jobs.length > 0) {
      const finishedIds = jobs
        .filter((j) => j.status !== 'RUNNING' && j.status !== 'QUEUED')
        .map((j) => j.id);
      setAcknowledgedFinishedJobIds(finishedIds);
    }
  }, [jobs, setAcknowledgedFinishedJobIds]);

  const [copyingJobId, setCopyingJobId] = useState<string | null>(null);

  async function cloneConfig(job: any) {
    if (copyingJobId) return;
    setCopyingJobId(job.id);
    try {
      const { job: detail } = await api.getJob(job.id);
      setCapabilityForm(detail.capabilityId, {
        modelVariant: detail.modelVariant,
        prompt: detail.basePrompt || '',
        negativePrompt: detail.baseNegativePrompt || '',
        media: detail.baseMedia || [],
        parameters: detail.baseParameters || {},
        matrix: detail.batchMatrix || { axes: [] },
      });
      message.success('已成功复制配置到工作台');
      navigate(`/c/${detail.capabilityId}`);
    } catch (err) {
      message.error('获取该任务完整配置失败：' + (err as Error).message);
    } finally {
      setCopyingJobId(null);
    }
  }

  const filteredJobs = jobs.filter((j) => {
    if (filterCap && j.capabilityId !== filterCap) return false;
    if (filterStatus && j.status !== filterStatus) return false;
    if (search) {
      const promptMatch = (j.basePrompt ?? '').toLowerCase().includes(search.toLowerCase());
      const idMatch = (j.id ?? '').toLowerCase().startsWith(search.toLowerCase());
      if (!promptMatch && !idMatch) return false;
    }
    return true;
  });

  // Filter subjobs for media view
  const filteredSubJobs = subJobs.filter((s) => {
    if (filterCap && s.capabilityId !== filterCap) return false;
    if (filterStatus && s.status !== filterStatus) return false;
    if (search) {
      const promptMatch = (s.paramsSnapshot?.prompt ?? '').toLowerCase().includes(search.toLowerCase());
      const idMatch = (s.jobId ?? '').toLowerCase().startsWith(search.toLowerCase()) || (s.id ?? '').toLowerCase().startsWith(search.toLowerCase());
      if (!promptMatch && !idMatch) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">任务历史</h1>
          <p className="text-sm text-zinc-500">所有当前账户的 Job 记录与生成产物列表</p>
        </div>
        
        {/* View Switcher */}
        <Radio.Group
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value)}
          className="dark-radio-group shadow-md"
        >
          <Radio.Button value="table" className="flex items-center gap-1.5 h-9">
            <span className="inline-flex items-center gap-1">
              <TableIcon size={14} />
              <span>表格列表</span>
            </span>
          </Radio.Button>
          <Radio.Button value="media" className="flex items-center gap-1.5 h-9">
            <span className="inline-flex items-center gap-1">
              <ImageIcon size={14} />
              <span>纯媒体预览</span>
            </span>
          </Radio.Button>
        </Radio.Group>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Select
          allowClear
          placeholder="按能力筛选"
          value={filterCap}
          onChange={setFilterCap}
          options={capabilities.map((c) => ({ value: c.id, label: c.shortName }))}
          style={{ minWidth: 160 }}
        />
        <Select
          allowClear
          placeholder="按状态筛选"
          value={filterStatus}
          onChange={setFilterStatus}
          options={['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELED'].map((s) => ({
            value: s,
            label: s,
          }))}
          style={{ minWidth: 160 }}
        />
        <Input.Search
          placeholder="搜 prompt 或 ID 前缀"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240 }}
          allowClear
        />
      </div>

      {/* Main View Area */}
      {viewMode === 'table' ? (
        <Table
          size="small"
          rowKey="id"
          loading={isJobsLoading}
          dataSource={filteredJobs}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 720 }}
          onRow={(record) => ({
            className: 'group cursor-pointer',
            onClick: () => navigate(`/tasks/${record.id}`),
          })}
          columns={[
            {
              title: 'ID',
              dataIndex: 'id',
              width: 120,
              render: (id: string) => (
                <Link to={`/tasks/${id}`} className="font-mono text-xs text-brand-300 hover:underline" onClick={(e) => e.stopPropagation()}>
                  {id ? id.slice(0, 8) : ''}
                </Link>
              ),
            },
            {
              title: '能力',
              dataIndex: 'capabilityId',
              width: 140,
              render: (id: string) => capabilities.find((c) => c.id === id)?.shortName ?? id,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s) => <StatusBadge status={s} kind="job" />,
            },
            {
              title: '进度',
              width: 90,
              render: (_, r) => (
                <span className="text-xs text-zinc-400">
                  {r.doneCount + r.failedCount}/{r.totalSubJobs}
                </span>
              ),
            },
            {
              title: 'Prompt',
              dataIndex: 'basePrompt',
              ellipsis: true,
              render: (p) => p ? <span className="text-sm text-zinc-300">{p}</span> : <span className="text-zinc-600">—</span>,
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 120,
              render: (t) => <span className="text-xs text-zinc-500">{formatRelative(t)}</span>,
            },
            {
              title: '操作',
              width: 80,
              render: (_, r) => (
                <Tooltip title="复制配置到工作台">
                  <Button
                    type="text"
                    size="small"
                    loading={copyingJobId === r.id}
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-brand-300 hover:bg-brand-500/10 flex items-center justify-center"
                    icon={copyingJobId === r.id ? undefined : <Copy size={13} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      cloneConfig(r);
                    }}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      ) : (
        /* Pure Media Preview Mode */
        <div>
          {isSubJobsLoading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-zinc-500">
              <Loader2 className="animate-spin text-brand-400" size={24} />
              <span>正在汇聚视频与图像产物…</span>
            </div>
          ) : filteredSubJobs.length === 0 ? (
            <Empty description="暂无符合条件的生成产物" />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSubJobs.map((subJob) => {
                const capabilityName =
                  capabilities.find((c) => c.id === subJob.capabilityId)?.shortName || subJob.capabilityId;
                const hasMedia = subJob.resultUrls && subJob.resultUrls.length > 0;

                return (
                  <Card
                    key={subJob.id}
                    className="border border-zinc-800 bg-zinc-900/30 overflow-hidden hover:border-brand-500/50 transition-colors"
                    styles={{ body: { padding: '12px' } }}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/tasks/${subJob.jobId}`}
                          className="font-mono text-brand-300 hover:underline"
                        >
                          #{subJob.indexInJob} ({subJob.jobId ? subJob.jobId.slice(0, 6) : ''})
                        </Link>
                        <span className="text-zinc-500">•</span>
                        <span className="text-zinc-400">{capabilityName}</span>
                      </div>
                      <StatusBadge status={subJob.status} />
                    </div>

                    {/* Media Body */}
                    {hasMedia ? (
                      <div className="space-y-2 mb-3 rounded-lg overflow-hidden border border-zinc-850">
                        {subJob.resultUrls!.map((r, i) => (
                          <PreviewWithExpiry key={i} url={r.url} expiresAt={r.expiresAt} kind={r.kind} />
                        ))}
                      </div>
                    ) : (
                      <div className="aspect-[16/9] w-full mb-3 rounded-lg bg-zinc-950 flex flex-col items-center justify-center border border-zinc-850 text-zinc-600 text-xs">
                        {subJob.status === 'RUNNING' || subJob.status === 'SUBMITTED' ? (
                          <>
                            <Loader2 className="animate-spin text-brand-400 mb-2" size={20} />
                            <span>主脑正在渲染中…</span>
                          </>
                        ) : subJob.status === 'FAILED' || subJob.status === 'DEAD' ? (
                          <span className="text-red-400">渲染失败</span>
                        ) : (
                          <span>等待提交渲染</span>
                        )}
                      </div>
                    )}

                    {/* Footer Info */}
                    <div className="space-y-2">
                      {subJob.paramsSnapshot?.prompt && (
                        <div
                          className="text-[11px] text-zinc-400 leading-relaxed bg-zinc-950/40 p-2 rounded cursor-help line-clamp-2 hover:line-clamp-none transition-all"
                          title={subJob.paramsSnapshot.prompt}
                        >
                          {subJob.paramsSnapshot.prompt}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
                        <span>{subJob.finishedAt ? formatRelative(subJob.finishedAt) : formatRelative(subJob.submittedAt ?? Date.now())}</span>
                        {subJob.paramsSnapshot && (
                          <button
                            onClick={() => {
                              setCapabilityForm(subJob.capabilityId, {
                                modelVariant: subJob.paramsSnapshot.model,
                                prompt: subJob.paramsSnapshot.prompt || '',
                                negativePrompt: subJob.paramsSnapshot.negativePrompt || '',
                                media: subJob.paramsSnapshot.media || [],
                                parameters: subJob.paramsSnapshot.params || {},
                              });
                              message.success('已应用此子任务配置到工作台');
                              navigate(`/c/${subJob.capabilityId}`);
                            }}
                            className="text-brand-400 hover:text-brand-300"
                          >
                            应用此配置
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
