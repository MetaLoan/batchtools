import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, Input, Table } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelative } from '../lib/format';
import { useCapabilities } from '../App';

export default function TasksPage() {
  const { data: capabilities = [] } = useCapabilities();
  const [filterCap, setFilterCap] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(200).then((r) => r.jobs),
    refetchInterval: 8000,
  });

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
        ]}
      />
    </div>
  );
}
