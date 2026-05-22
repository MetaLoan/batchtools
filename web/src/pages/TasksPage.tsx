import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { App as AntApp, Select, Input, Table, Tooltip, Button } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelative } from '../lib/format';
import { useCapabilities } from '../App';
import { useAppStore } from '../lib/store';

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

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(200).then((r) => r.jobs),
    refetchInterval: 8000,
  });

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

  const filtered = jobs.filter((j) => {
    if (filterCap && j.capabilityId !== filterCap) return false;
    if (filterStatus && j.status !== filterStatus) return false;
    if (search && !(j.basePrompt ?? '').includes(search) && !j.id.startsWith(search)) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">任务历史</h1>
      <p className="mb-4 text-sm text-zinc-500">所有当前账户的 Job 记录</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
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

      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 720 }}
        onRow={() => ({
          className: 'group cursor-pointer',
        })}
        columns={[
          {
            title: 'ID',
            dataIndex: 'id',
            width: 120,
            render: (id: string) => (
              <Link to={`/tasks/${id}`} className="font-mono text-xs text-brand-300 hover:underline">
                {id.slice(0, 8)}
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
    </div>
  );
}
