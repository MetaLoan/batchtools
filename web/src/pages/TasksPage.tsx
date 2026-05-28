import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { App as AntApp, Select, Input, Table, Tooltip, Button, Radio, Empty, Card, Spin, Modal, Dropdown } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Table as TableIcon, Image as ImageIcon, Loader2, Folder, FolderPlus, Trash2, Download, Inbox, FolderOpen, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelative } from '../lib/format';
import { useCapabilities } from '../App';
import { useAppStore } from '../lib/store';
import PreviewWithExpiry from '../components/PreviewWithExpiry';

export default function TasksPage() {
  const { message, modal } = AntApp.useApp();
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

  // Selected folder: undefined = All, null = Uncategorized, string = Folder ID
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | undefined>(undefined);

  // Create folder states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Selected table rows
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Fetch folders list
  const { data: folders = [], refetch: refetchFolders } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.listFolders().then((r) => r.folders),
  });

  const { data: jobs = [], isLoading: isJobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['jobs', selectedFolderId],
    queryFn: () => api.listJobs(200, selectedFolderId).then((r) => r.jobs),
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

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [selectedFolderId]);

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

  async function handleDeleteJob(jobId: string) {
    modal.confirm({
      title: '确认删除任务记录',
      content: '确定要删除这条任务记录吗？此操作将同时删除其所有子任务记录，且不可恢复。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.deleteJob(jobId);
          message.success('删除任务记录成功');
          refetchJobs();
        } catch (err) {
          message.error('删除失败: ' + (err as Error).message);
        }
      }
    });
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) {
      message.error('文件夹名称不能为空');
      return;
    }
    setIsCreatingFolder(true);
    try {
      await api.createFolder(newFolderName.trim());
      message.success('创建文件夹成功');
      setNewFolderName('');
      setIsCreateModalOpen(false);
      refetchFolders();
    } catch (err) {
      message.error('创建文件夹失败: ' + (err as Error).message);
    } finally {
      setIsCreatingFolder(false);
    }
  }

  async function handleDeleteFolder(id: string, name: string) {
    Modal.confirm({
      title: '删除文件夹',
      content: `您确定要删除文件夹 "${name}" 吗？删除后其中的任务不会被删除，将自动归入“未分类”。`,
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteFolder(id);
          message.success('删除文件夹成功');
          if (selectedFolderId === id) {
            setSelectedFolderId(undefined); // 退回到全部任务
          }
          refetchFolders();
          refetchJobs();
        } catch (err) {
          message.error('删除文件夹失败: ' + (err as Error).message);
        }
      },
    });
  }

  function handleDownloadFolder(folderId: string) {
    const url = `/v1/jobs/batch-download?folderId=${folderId}`;
    window.open(url, '_blank');
  }

  async function handleBatchMove(folderId: string | null) {
    if (selectedRowKeys.length === 0) return;
    try {
      await api.batchMoveJobs(selectedRowKeys as string[], folderId);
      message.success('批量移动成功');
      setSelectedRowKeys([]);
      refetchJobs();
    } catch (err) {
      message.error('批量移动失败: ' + (err as Error).message);
    }
  }

  function handleBatchDownload() {
    if (selectedRowKeys.length === 0) return;
    const url = `/v1/jobs/batch-download?jobIds=${selectedRowKeys.join(',')}`;
    window.open(url, '_blank');
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
    if (selectedFolderId !== undefined) {
      const parentJob = jobs.find((j) => j.id === s.jobId);
      if (!parentJob) return false;
    }
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
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 flex flex-col md:flex-row gap-6">
      {/* Sidebar - Folder Management */}
      <div className="w-60 flex-shrink-0 border-r border-zinc-800/80 pr-6 hidden md:block">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">文件夹</span>
          <Tooltip title="新建文件夹">
            <Button
              type="text"
              size="small"
              className="text-zinc-400 hover:text-brand-300 flex items-center justify-center"
              icon={<FolderPlus size={16} />}
              onClick={() => setIsCreateModalOpen(true)}
            />
          </Tooltip>
        </div>

        <div className="space-y-1">
          {/* All Tasks */}
          <button
            onClick={() => setSelectedFolderId(undefined)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              selectedFolderId === undefined
                ? 'bg-brand-500/10 text-brand-300'
                : 'text-zinc-450 hover:bg-zinc-800/30 hover:text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Inbox size={16} />
              <span>全部任务</span>
            </div>
          </button>

          {/* Uncategorized */}
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              selectedFolderId === null
                ? 'bg-brand-500/10 text-brand-300'
                : 'text-zinc-450 hover:bg-zinc-800/30 hover:text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <FolderOpen size={16} />
              <span>未分类</span>
            </div>
          </button>

          <div className="my-2 border-t border-zinc-800/60" />

          {/* Custom Folders */}
          {folders.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-zinc-600">
              暂无自定义文件夹
            </div>
          ) : (
            folders.map((folder) => {
              const isSelected = selectedFolderId === folder.id;
              return (
                <div
                  key={folder.id}
                  className={`group/item flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-brand-500/10 text-brand-300'
                      : 'text-zinc-450 hover:bg-zinc-800/30 hover:text-zinc-200'
                  }`}
                >
                  <button
                    onClick={() => setSelectedFolderId(folder.id)}
                    className="flex flex-1 items-center gap-2 text-left min-w-0"
                  >
                    <Folder size={16} className="flex-shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </button>

                  <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                    <Tooltip title="下载整个文件夹视频">
                      <Button
                        type="text"
                        size="small"
                        className="h-6 w-6 p-0 text-zinc-500 hover:text-brand-300 flex items-center justify-center"
                        icon={<Download size={13} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadFolder(folder.id);
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="删除文件夹">
                      <Button
                        type="text"
                        size="small"
                        className="h-6 w-6 p-0 text-zinc-500 hover:text-red-400 flex items-center justify-center"
                        icon={<Trash2 size={13} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(folder.id, folder.name);
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main List Area */}
      <div className="flex-1 min-w-0">
        <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="mb-1 text-2xl font-semibold">
              任务历史
              {selectedFolderId !== undefined && (
                <span className="text-zinc-500 text-lg font-normal ml-2">
                  / {selectedFolderId === null ? '未分类' : folders.find((f) => f.id === selectedFolderId)?.name || '文件夹'}
                </span>
              )}
            </h1>
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
          {/* Mobile Folder Select */}
          <div className="block md:hidden w-full max-w-[200px]">
            <Select
              placeholder="切换文件夹"
              value={selectedFolderId === undefined ? 'all' : (selectedFolderId === null ? 'uncategorized' : selectedFolderId)}
              onChange={(val) => {
                if (val === 'all') setSelectedFolderId(undefined);
                else if (val === 'uncategorized') setSelectedFolderId(null);
                else setSelectedFolderId(val);
              }}
              options={[
                { value: 'all', label: '全部任务' },
                { value: 'uncategorized', label: '未分类' },
                ...folders.map((f) => ({ value: f.id, label: f.name }))
              ]}
              style={{ width: '100%' }}
            />
          </div>

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

          {/* Mobile Folder Creation */}
          <div className="block md:hidden">
            <Button
              type="default"
              icon={<FolderPlus size={14} />}
              onClick={() => setIsCreateModalOpen(true)}
            >
              新建文件夹
            </Button>
          </div>
        </div>

        {/* Batch Actions Bar */}
        {selectedRowKeys.length > 0 && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-zinc-300">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">已选择 {selectedRowKeys.length} 项</span>
            </div>
            <div className="flex items-center gap-2">
              <Dropdown
                menu={{
                  items: [
                    ...folders.map((f) => ({
                      key: f.id,
                      label: `移至：${f.name}`,
                      onClick: () => handleBatchMove(f.id),
                    })),
                    { type: 'divider' as const },
                    {
                      key: 'uncategorized',
                      label: '移至：未分类',
                      onClick: () => handleBatchMove(null),
                    },
                  ],
                }}
                trigger={['click']}
              >
                <Button size="small" type="primary" ghost>
                  批量移动至...
                </Button>
              </Dropdown>
              <Button
                size="small"
                type="primary"
                icon={<Download size={14} />}
                onClick={handleBatchDownload}
              >
                批量下载视频
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => setSelectedRowKeys([])}
                className="text-zinc-400 hover:text-zinc-200"
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {/* Main View Area */}
        {viewMode === 'table' ? (
          <Table
            size="small"
            rowKey="id"
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
            }}
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
                title: '预览',
                width: 60,
                render: (_, r) => {
                  if (!r.previewUrl) {
                    if (r.status === 'RUNNING' || r.status === 'QUEUED') {
                      return (
                        <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center">
                          <Loader2 className="animate-spin text-brand-400" size={16} />
                        </div>
                      );
                    }
                    return (
                      <div className="w-10 h-10 rounded bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center text-zinc-600 text-xs">
                        —
                      </div>
                    );
                  }

                  const isVideo = /\.(mp4|mov|webm)/i.test(r.previewUrl.split('?')[0]);
                  if (isVideo) {
                    return (
                      <video
                        src={r.previewUrl}
                        className="w-10 h-10 object-cover rounded border border-zinc-800 bg-black"
                        preload="metadata"
                        muted
                        playsInline
                      />
                    );
                  }

                  return (
                    <img
                      src={r.previewUrl}
                      className="w-10 h-10 object-cover rounded border border-zinc-800 bg-zinc-900"
                      alt="Preview"
                    />
                  );
                },
              },
              {
                title: '任务名称',
                dataIndex: 'id',
                width: 220,
                ellipsis: true,
                render: (id: string) => (
                  <Tooltip title={id}>
                    <Link to={`/tasks/${id}`} className="font-mono text-xs text-brand-300 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {id}
                    </Link>
                  </Tooltip>
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
                  <span className="text-xs text-zinc-450">
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
                width: 100,
                render: (_, r) => (
                  <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="复制配置到工作台">
                      <Button
                        type="text"
                        size="small"
                        loading={copyingJobId === r.id}
                        className="text-zinc-400 hover:text-brand-300 hover:bg-brand-500/10 flex items-center justify-center"
                        icon={copyingJobId === r.id ? undefined : <Copy size={13} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          cloneConfig(r);
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="删除任务记录">
                      <Button
                        type="text"
                        size="small"
                        className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center"
                        icon={<Trash2 size={13} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteJob(r.id);
                        }}
                      />
                    </Tooltip>
                  </div>
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
                          <span className="text-zinc-505">•</span>
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

      {/* Create Folder Modal */}
      <Modal
        title="创建新文件夹"
        open={isCreateModalOpen}
        onOk={handleCreateFolder}
        onCancel={() => {
          setIsCreateModalOpen(false);
          setNewFolderName('');
        }}
        confirmLoading={isCreatingFolder}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <div className="py-4">
          <Input
            placeholder="请输入文件夹名称"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onPressEnter={handleCreateFolder}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}
