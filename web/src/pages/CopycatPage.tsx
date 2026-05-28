import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Table, Button, Modal, Input, InputNumber, Select, Checkbox, DatePicker, Tabs, Drawer, Badge, Space, Upload, Tooltip } from 'antd';
import { Plus, Trash2, Play, Pause, RefreshCw, Film, Video, Image as ImageIcon, Sparkles, Loader2, ArrowRight, Music, UserCheck, Calendar, Eye, ExternalLink, ShieldAlert, Copy } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

interface Blogger {
  id: string;
  homepageUrl: string;
  handle: string;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
  crawlError?: string;
  status: string;
  createdAt: number;
  lastCrawledAt?: number;
}

interface Strategy {
  id: string;
  name: string;
  type: string;
  accountId: string;
  bloggerIdsJson: string; // JSON array of blogger IDs
  filterMinDuration?: number;
  filterMaxDuration?: number;
  filterPublishAfter?: number;
  filterMinPlayCount?: number;
  filterDeduplicate: number;
  refImageUrl: string;
  persona: string;
  stylePrompt: string;
  outputCount: number;
  reuseAudio: number;
  crawlIntervalHours: number;
  status: string;
  createdAt: number;
  lastExecutedAt?: number;
  destFolderId?: string | null;
  autoCreateFolder?: number;
  lastRunLog?: string | null;
}

interface ExecutionLog {
  strategyId: string;
  videoUniqueId: string;
  jobId: string | null;
  processedAt: number;
  videoTitle: string | null;
  videoUrl: string | null;
  downloadUrl: string | null;
}

export default function CopycatPage() {
  const { message, modal } = AntApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const currentAccountId = useAppStore((s) => s.currentAccountId);
  const [activeTab, setActiveTab] = useState('strategies');

  // Queries
  const { data: strategies = [], isLoading: isStrategiesLoading } = useQuery<Strategy[]>({
    queryKey: ['copycat_strategies'],
    queryFn: () => api.listCopycatStrategies(),
  });

  const { data: folderRes, refetch: refetchFolders } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.listFolders(),
  });
  const folders = folderRes?.folders || [];

  const { data: bloggers = [], isLoading: isBloggersLoading } = useQuery<Blogger[]>({
    queryKey: ['tk_bloggers'],
    queryFn: () => api.listTkBloggers(),
    refetchInterval: (query: any) => {
      const data = query.state.data as Blogger[] | undefined;
      return data?.some((b: Blogger) => !b.lastCrawledAt) ? 3000 : false;
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.listAccounts().then((r) => r.accounts),
  });

  const currentAccountName = accounts.find((a) => a.id === currentAccountId)?.name || '未选择账户';

  // State: Add Blogger Modal
  const [isAddBloggerOpen, setIsAddBloggerOpen] = useState(false);
  const [bloggerUrl, setBloggerUrl] = useState('');
  const [isAddingBlogger, setIsAddingBlogger] = useState(false);

  // State & Query: Crawler Settings Modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsCookiesText, setSettingsCookiesText] = useState('');
  
  const { data: crawlerSettings } = useQuery({
    queryKey: ['crawler_settings'],
    queryFn: () => api.getCrawlerSettings(),
    enabled: isSettingsOpen,
  });

  const [prevSettings, setPrevSettings] = useState<any>(null);
  if (crawlerSettings && crawlerSettings !== prevSettings) {
    setSettingsCookiesText(crawlerSettings.cookiesText || '');
    setPrevSettings(crawlerSettings);
  }

  const saveSettingsMutation = useMutation({
    mutationFn: (text: string) => api.saveCrawlerSettings({ cookiesText: text }),
    onSuccess: () => {
      message.success('登录 Cookies 保存成功！后台已触发所有博主重试同步。');
      setIsSettingsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tk_bloggers'] });
    },
    onError: (err: any) => {
      message.error(`同步保存失败: ${err.message || '未知原因'}`);
    },
  });

  // State: Save/Edit Strategy Drawer
  const [isStrategyDrawerOpen, setIsStrategyDrawerOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);

  // Form State: Strategy
  const [stratName, setStratName] = useState('');
  const [stratType, setStratType] = useState('video_edit'); // video_edit | r2v
  const [stratAccountId, setStratAccountId] = useState('');
  const [stratBloggerIds, setStratBloggerIds] = useState<string[]>([]);
  
  // Filters
  const [useDurationFilter, setUseDurationFilter] = useState(false);
  const [minDur, setMinDur] = useState<number>(0);
  const [maxDur, setMaxDur] = useState<number>(30);
  
  const [useDateFilter, setUseDateFilter] = useState(false);
  const [publishAfterDate, setPublishAfterDate] = useState<dayjs.Dayjs | null>(null);
  
  const [usePlayFilter, setUsePlayFilter] = useState(false);
  const [minPlayCount, setMinPlayCount] = useState<number>(1000);
  
  const [deduplicate, setDeduplicate] = useState(true);

  // Appearance & Style
  const [refImageUrl, setRefImageUrl] = useState('');
  const [persona, setPersona] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [destFolderId, setDestFolderId] = useState<string | null>(null);
  const [autoCreateFolder, setAutoCreateFolder] = useState(false);
  const [outputCount, setOutputCount] = useState(1);
  const [reuseAudio, setReuseAudio] = useState(true);
  const [intervalHours, setIntervalHours] = useState(6);

  const [isUploading, setIsUploading] = useState(false);

  // State: Logs Drawer
  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false);
  const [logStrategyId, setLogStrategyId] = useState<string | null>(null);
  const [logStrategyName, setLogStrategyName] = useState('');
  const { data: executionLogs = [], isLoading: isLogsLoading } = useQuery<ExecutionLog[]>({
    queryKey: ['copycat_logs', logStrategyId],
    queryFn: () => api.getCopycatLogs(logStrategyId!).then((r) => r.logs),
    enabled: !!logStrategyId,
  });

  // State: Blogger Videos Preview Drawer (动态分页与懒加载抓取)
  const [previewBloggerId, setPreviewBloggerId] = useState<string | null>(null);
  const [previewBloggerName, setPreviewBloggerName] = useState('');
  const [bloggerVideos, setBloggerVideos] = useState<any[]>([]);
  const [isBloggerVideosLoading, setIsBloggerVideosLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreVideos, setHasMoreVideos] = useState(true);

  async function loadMoreBloggerVideos(bloggerId: string, isInitial = false) {
    const currentOffset = isInitial ? 0 : bloggerVideos.length;
    if (isInitial) {
      setIsBloggerVideosLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    try {
      const res = await api.getTkBloggerVideos(bloggerId, 12, currentOffset);
      if (isInitial) {
        setBloggerVideos(res.videos);
      } else {
        setBloggerVideos((prev) => {
          // 去重合并
          const existingIds = new Set(prev.map(v => v.id));
          const newVids = res.videos.filter(v => !existingIds.has(v.id));
          return [...prev, ...newVids];
        });
      }
      setHasMoreVideos(res.videos.length === 12);
    } catch (err) {
      message.error('拉取视频列表失败: ' + (err as Error).message);
    } finally {
      setIsBloggerVideosLoading(false);
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    if (previewBloggerId) {
      setBloggerVideos([]);
      setHasMoreVideos(true);
      loadMoreBloggerVideos(previewBloggerId, true);
    }
  }, [previewBloggerId]);

  // Blogger Mutations
  const addBloggerMutation = useMutation({
    mutationFn: (url: string) => api.addTkBlogger(url),
    onSuccess: () => {
      message.success('博主添加成功，后台已启动首次采集！');
      setIsAddBloggerOpen(false);
      setBloggerUrl('');
      queryClient.invalidateQueries({ queryKey: ['tk_bloggers'] });
    },
    onError: (err: any) => {
      message.error(`添加失败: ${err.message || '未知原因'}`);
    },
  });

  const deleteBloggerMutation = useMutation({
    mutationFn: (id: string) => api.deleteTkBlogger(id),
    onSuccess: () => {
      message.success('已删除博主监控及已抓取素材');
      queryClient.invalidateQueries({ queryKey: ['tk_bloggers'] });
    },
    onError: (err: any) => {
      message.error(`删除失败: ${err.message || '未知原因'}`);
    },
  });

  const syncBloggerMutation = useMutation({
    mutationFn: (id: string) => api.syncTkBlogger(id),
    onSuccess: (data: any) => {
      message.success(`同步完成，新增采集到 ${data.crawledCount || 0} 个视频！`);
      queryClient.invalidateQueries({ queryKey: ['tk_bloggers'] });
    },
    onError: (err: any) => {
      message.error(`同步失败: ${err.message || '未知原因'}`);
    },
  });

  // Strategy Mutations
  const saveStrategyMutation = useMutation({
    mutationFn: (input: any) => api.saveCopycatStrategy(input),
    onSuccess: () => {
      message.success(editingStrategy ? '同款策略更新成功' : '同款策略创建成功');
      setIsStrategyDrawerOpen(false);
      resetStrategyForm();
      queryClient.invalidateQueries({ queryKey: ['copycat_strategies'] });
    },
    onError: (err: any) => {
      message.error(`保存失败: ${err.message || '未知原因'}`);
    },
  });

  const toggleStrategyMutation = useMutation({
    mutationFn: (id: string) => api.toggleCopycatStrategy(id),
    onSuccess: (data) => {
      message.success(`策略状态已修改为: ${data.status === 'active' ? '开启' : '暂停'}`);
      queryClient.invalidateQueries({ queryKey: ['copycat_strategies'] });
    },
    onError: (err: any) => {
      message.error(`状态修改失败: ${err.message || '未知原因'}`);
    },
  });

  const runStrategyMutation = useMutation({
    mutationFn: (id: string) => api.runCopycatStrategy(id),
    onSuccess: (data) => {
      message.success(`手动运行触发成功！新增处理并生成了 ${data.processedCount || 0} 个同款视频任务`);
      queryClient.invalidateQueries({ queryKey: ['copycat_strategies'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err: any) => {
      message.error(`运行失败: ${err.message || '未知原因'}`);
    },
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: (id: string) => api.deleteCopycatStrategy(id),
    onSuccess: () => {
      message.success('同款策略已成功删除');
      queryClient.invalidateQueries({ queryKey: ['copycat_strategies'] });
    },
    onError: (err: any) => {
      message.error(`删除失败: ${err.message || '未知原因'}`);
    },
  });

  const copyStrategyMutation = useMutation({
    mutationFn: (id: string) => api.copyCopycatStrategy(id),
    onSuccess: () => {
      message.success('策略复制成功，默认处于暂停状态');
      queryClient.invalidateQueries({ queryKey: ['copycat_strategies'] });
    },
    onError: (err: any) => {
      message.error(`复制失败: ${err.message || '未知原因'}`);
    },
  });

  // Handlers
  const handleAddBloggerSubmit = () => {
    if (!bloggerUrl.trim()) {
      message.warning('请输入 TikTok 博主主页 URL');
      return;
    }
    addBloggerMutation.mutate(bloggerUrl.trim());
  };

  const handleCustomUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    setIsUploading(true);
    try {
      const res = await api.uploadFile(file as File);
      setRefImageUrl(res.publicUrl);
      onSuccess(res);
      message.success('图片上传成功！已自动填入人设照片');
    } catch (err: any) {
      onError(err);
      message.error(`上传失败: ${err.message || '未知原因'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const resetStrategyForm = () => {
    setEditingStrategy(null);
    setStratName('');
    setStratType('video_edit');
    setStratAccountId(currentAccountId || '');
    setStratBloggerIds([]);
    setUseDurationFilter(false);
    setMinDur(0);
    setMaxDur(30);
    setUseDateFilter(false);
    setPublishAfterDate(null);
    setUsePlayFilter(false);
    setMinPlayCount(1000);
    setDeduplicate(true);
    setRefImageUrl('');
    setPersona('');
    setStylePrompt('');
    setOutputCount(1);
    setReuseAudio(true);
    setIntervalHours(6);
    setDestFolderId(null);
    setAutoCreateFolder(false);
  };

  const handleOpenNewStrategy = () => {
    resetStrategyForm();
    if (accounts.length > 0) {
      setStratAccountId(currentAccountId || accounts[0].id);
    }
    setIsStrategyDrawerOpen(true);
  };

  const handleOpenEditStrategy = (strat: Strategy) => {
    setEditingStrategy(strat);
    setStratName(strat.name);
    setStratType(strat.type);
    setStratAccountId(strat.accountId);
    try {
      setStratBloggerIds(JSON.parse(strat.bloggerIdsJson));
    } catch {
      setStratBloggerIds([]);
    }
    
    // Set filters
    if (strat.filterMinDuration !== undefined && strat.filterMinDuration !== null) {
      setUseDurationFilter(true);
      setMinDur(strat.filterMinDuration);
    } else {
      setUseDurationFilter(false);
    }
    if (strat.filterMaxDuration !== undefined && strat.filterMaxDuration !== null) {
      setUseDurationFilter(true);
      setMaxDur(strat.filterMaxDuration);
    }
    if (strat.filterPublishAfter) {
      setUseDateFilter(true);
      setPublishAfterDate(dayjs(strat.filterPublishAfter));
    } else {
      setUseDateFilter(false);
      setPublishAfterDate(null);
    }
    if (strat.filterMinPlayCount) {
      setUsePlayFilter(true);
      setMinPlayCount(strat.filterMinPlayCount);
    } else {
      setUsePlayFilter(false);
    }
    setDeduplicate(strat.filterDeduplicate === 1);
    setRefImageUrl(strat.refImageUrl);
    setPersona(strat.persona);
    setStylePrompt(strat.stylePrompt);
    setOutputCount(strat.outputCount);
    setReuseAudio(strat.reuseAudio === 1);
    setIntervalHours(strat.crawlIntervalHours);
    setDestFolderId(strat.destFolderId || null);
    setAutoCreateFolder(strat.autoCreateFolder === 1);
    
    setIsStrategyDrawerOpen(true);
  };

  const handleSaveStrategySubmit = () => {
    if (!stratName.trim()) {
      message.warning('请输入策略名称');
      return;
    }
    if (!stratAccountId) {
      message.warning('请选择生成调用的 API 账户');
      return;
    }
    if (stratBloggerIds.length === 0) {
      message.warning('请选择至少一个监控博主');
      return;
    }
    if (!refImageUrl.trim()) {
      message.warning('请上传或输入人设照片 URL');
      return;
    }
    if (!persona.trim()) {
      message.warning('请输入人设形象描述');
      return;
    }
    if (!stylePrompt.trim()) {
      message.warning('请输入修改风格提示词');
      return;
    }

    const payload = {
      id: editingStrategy?.id || undefined,
      name: stratName.trim(),
      type: stratType,
      accountId: stratAccountId,
      bloggerIds: stratBloggerIds,
      filterMinDuration: useDurationFilter ? minDur : null,
      filterMaxDuration: useDurationFilter ? maxDur : null,
      filterPublishAfter: useDateFilter && publishAfterDate ? publishAfterDate.valueOf() : null,
      filterMinPlayCount: usePlayFilter ? minPlayCount : null,
      filterDeduplicate: deduplicate,
      refImageUrl: refImageUrl.trim(),
      persona: persona.trim(),
      stylePrompt: stylePrompt.trim(),
      outputCount,
      reuseAudio,
      crawlIntervalHours: intervalHours,
      destFolderId: autoCreateFolder ? null : destFolderId,
      autoCreateFolder,
    };

    saveStrategyMutation.mutate(payload);
  };

  const handleOpenLogs = (strat: Strategy) => {
    setLogStrategyId(strat.id);
    setLogStrategyName(strat.name);
    setLogsDrawerOpen(true);
  };

  // Render Page Content
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="bg-gradient-to-r from-brand-400 to-indigo-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            TK 博主监控做同款
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            自动监控指定 TikTok 博主视频。通过人设照片结合 Wan 2.7 视频编辑与 R2V 策略，全天候全自动批量输出“爆款同款”视频。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => setIsSettingsOpen(true)}
            className="!h-10 border border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:text-white hover:border-brand-500 font-medium"
          >
            爬虫 & Cookies 设置
          </Button>
          {activeTab === 'strategies' && (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={handleOpenNewStrategy}
              className="!h-10 bg-brand-600 hover:bg-brand-500 border-none font-medium text-white shadow-lg shadow-brand-500/20"
            >
              新建做同款策略
            </Button>
          )}
          {activeTab === 'bloggers' && (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => setIsAddBloggerOpen(true)}
              className="!h-10 bg-brand-600 hover:bg-brand-500 border-none font-medium text-white shadow-lg shadow-brand-500/20"
            >
              添加监控博主
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="dark-tabs mb-6"
        items={[
          {
            key: 'strategies',
            label: '做同款策略库',
            children: isStrategiesLoading ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-zinc-500">
                <Loader2 className="animate-spin text-brand-400" size={32} />
                <span>正在获取策略库...</span>
              </div>
            ) : strategies.length === 0 ? (
              <div className="glass-panel flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-600">
                  <Film size={28} />
                </div>
                <h3 className="text-lg font-medium text-zinc-200">暂无做同款策略</h3>
                <p className="mt-2 max-w-md text-sm text-zinc-500">
                  选择您监控的博主，上传您的人设图片，配置好规则后，系统将自动在后台扫描符合条件的视频进行同款改写。
                </p>
                <Button
                  type="primary"
                  icon={<Plus size={16} />}
                  onClick={handleOpenNewStrategy}
                  className="mt-6 bg-brand-600 hover:bg-brand-500 border-none text-white"
                >
                  创建同款策略
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {strategies.map((strat, idx) => {
                  let bloggersList: string[] = [];
                  try {
                    const ids = JSON.parse(strat.bloggerIdsJson);
                    bloggersList = ids.map((id: string) => bloggers.find((b) => b.id === id)?.handle || id);
                  } catch {}

                  return (
                    <motion.div
                      key={strat.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.05 }}
                      className="surface surface-hover flex flex-col overflow-hidden border border-zinc-800 bg-zinc-900/40 shadow-xl"
                    >
                      {/* Thumbnail Header */}
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-950">
                        <img
                          src={strat.refImageUrl}
                          alt={strat.name}
                          className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                        <div className="absolute bottom-3 left-4 right-4">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                            strat.type === 'video_edit'
                              ? 'bg-blue-500/10 text-blue-300 ring-blue-500/30'
                              : 'bg-purple-500/10 text-purple-300 ring-purple-500/30'
                          }`}>
                            {strat.type === 'video_edit' ? 'Wan 2.7 Video Edit' : 'Wan 2.7 R2V'}
                          </span>
                          <h3 className="mt-1 text-lg font-bold text-zinc-100 truncate">
                            {strat.name}
                          </h3>
                        </div>
                        {/* Active/Paused status badge top right */}
                        <div className="absolute top-3 right-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium border ${
                            strat.status === 'active'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                          }`}>
                            <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${strat.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                            {strat.status === 'active' ? '运行中' : '已暂停'}
                          </span>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex flex-1 flex-col p-4">
                        <div className="mb-4 flex-1 space-y-3">
                          {/* Target bloggers */}
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              监控账号
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {bloggersList.slice(0, 3).map((handle, i) => (
                                <span key={i} className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                                  {handle}
                                </span>
                              ))}
                              {bloggersList.length > 3 && (
                                <span className="inline-block rounded bg-zinc-850 px-1.5 py-0.5 text-xs text-zinc-400">
                                  +{bloggersList.length - 3} 个博主
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Persona & prompt */}
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              人设基调
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs text-zinc-400 leading-relaxed italic bg-zinc-950/40 p-2 border border-zinc-850 rounded">
                              "{strat.persona}"
                            </div>
                          </div>

                          {/* Filters Summary */}
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500 pt-1">
                            <div>
                              <span>去重模式: </span>
                              <span className="text-zinc-300 font-semibold">{strat.filterDeduplicate ? '是' : '否'}</span>
                            </div>
                            <div>
                              <span>自动周期: </span>
                              <span className="text-zinc-300 font-semibold">{strat.crawlIntervalHours}小时/次</span>
                            </div>
                            <div className="col-span-2">
                              <span>音频复用: </span>
                              <span className="text-zinc-300 font-semibold">{strat.reuseAudio ? '🔊 复用原视频音轨' : '🔇 AI 视频原静音'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-zinc-850 my-2 pt-2 flex flex-col gap-2">
                          <div className="flex justify-between items-center text-xs text-zinc-500">
                            <span>上次运行: </span>
                            <span>{strat.lastExecutedAt ? dayjs(strat.lastExecutedAt).format('MM-DD HH:mm') : '未执行'}</span>
                          </div>
                          {strat.lastRunLog && (
                            <div className="mt-1 p-2 bg-zinc-950/60 rounded border border-zinc-850 font-mono text-[10px] text-zinc-400 leading-normal flex items-start gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-1.5 shrink-0 animate-pulse" />
                              <span className="flex-1 text-left">{strat.lastRunLog}</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1.5 mt-2">
                          <Button
                            type="primary"
                            icon={runStrategyMutation.isPending && runStrategyMutation.variables === strat.id ? <Loader2 className="animate-spin" size={12} /> : <Play size={12} />}
                            onClick={() => {
                              modal.confirm({
                                title: '执行策略扫描',
                                content: '您确定要立即运行此策略吗？系统将从关联博主视频库中扫描符合过滤条件的新视频并生成同款。',
                                onOk: () => runStrategyMutation.mutate(strat.id),
                              });
                            }}
                            disabled={strat.status !== 'active'}
                            className="flex-1 !h-8 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:border-brand-500 font-medium"
                          >
                            运行一次
                          </Button>
                          <Button
                            icon={strat.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                            onClick={() => toggleStrategyMutation.mutate(strat.id)}
                            className="!h-8 !px-2.5 border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-brand-400 hover:border-brand-500"
                          />
                          <Button
                            icon={<Eye size={12} />}
                            onClick={() => handleOpenLogs(strat)}
                            className="!h-8 !px-2.5 border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-indigo-400 hover:border-indigo-500"
                            title="查看已处理视频与生成日志"
                          />
                          <Tooltip title="复制该同款策略">
                            <Button
                              icon={copyStrategyMutation.isPending && copyStrategyMutation.variables === strat.id ? <Loader2 className="animate-spin" size={12} /> : <Copy size={12} />}
                              onClick={() => copyStrategyMutation.mutate(strat.id)}
                              className="!h-8 !px-2.5 border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-brand-400 hover:border-brand-500"
                            />
                          </Tooltip>
                          <Button
                            onClick={() => handleOpenEditStrategy(strat)}
                            className="!h-8 border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200"
                          >
                            编辑
                          </Button>
                          <Button
                            type="text"
                            danger
                            icon={<Trash2 size={12} />}
                            onClick={() => {
                              modal.confirm({
                                title: '确认删除同款策略',
                                content: `确定要删除策略「${strat.name}」吗？此操作不可逆，将移除对应日志。`,
                                okText: '确认删除',
                                okType: 'danger',
                                onOk: () => deleteStrategyMutation.mutate(strat.id),
                              });
                            }}
                            className="!h-8 !w-8 flex items-center justify-center border border-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                          />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ),
          },
          {
            key: 'bloggers',
            label: `TK博主监控库 (${bloggers.length})`,
            children: (
              <div className="space-y-6">
                <div className="glass-panel p-4 border border-zinc-800 bg-zinc-900/10 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                      <UserCheck size={16} className="text-brand-400" />
                      <span>管理监控的 TikTok 账号</span>
                    </h3>
                    <p className="text-xs text-zinc-500 leading-relaxed max-w-2xl">
                      在此录入您想监控的海外 TikTok 博主主页。系统会在后台使用爬虫定期拉取视频至本地存储（并强制转换为 10 秒以内片段）。
                    </p>
                  </div>
                  <Button
                    type="primary"
                    icon={<Plus size={14} />}
                    onClick={() => setIsAddBloggerOpen(true)}
                    className="bg-brand-600 hover:bg-brand-500 border-none text-white text-xs font-semibold"
                  >
                    录入博主链接
                  </Button>
                </div>

                {bloggers.some((b) => b.crawlError) && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3 items-start">
                    <ShieldAlert className="text-amber-500 shrink-0 mt-0.5" size={16} />
                    <div className="space-y-1.5 text-xs text-zinc-300">
                      <div className="font-bold text-amber-500">检测到部分博主同步异常（需同步登录状态/Cookies）</div>
                      <p className="leading-relaxed">
                        由于 TikTok 的敏感/年龄限制验证，未登录状态下可能无法爬取此类视频。
                        请在后端根目录下配置 <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[10px]">.env</code> 文件以恢复数据获取：
                      </p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>
                          <strong>推荐方式（本地浏览器共享）</strong>：在 <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[10px]">.env</code> 中开启并指定 <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[10px]">TIKTOK_COOKIES_FROM_BROWSER=chrome</code>（或 safari, edge），自动共享本地已登录的浏览器 Cookie。
                        </li>
                        <li>
                          <strong>服务器部署方式（文件导入）</strong>：使用浏览器插件（如 Get cookies.txt）导出 TikTok 的 Netscape 格式 cookies 文件到项目根目录下命名为 <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[10px]">cookies.txt</code>，并在 <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[10px]">.env</code> 中添加配置 <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[10px]">TIKTOK_COOKIES_FILE=./cookies.txt</code>。
                        </li>
                      </ul>
                      <p className="text-[10px] text-zinc-500 leading-normal">
                        配置保存后系统会自动重载后台服务。您可以点击下方列表右侧的操作进行“同步视频”验证。
                      </p>
                    </div>
                  </div>
                )}

                <div className="overflow-hidden border border-zinc-900 rounded-lg">
                  <Table
                    dataSource={bloggers}
                    loading={isBloggersLoading}
                    rowKey="id"
                    pagination={{ pageSize: 10 }}
                    className="dark-table"
                    columns={[
                      {
                        title: '博主昵称 / Handle',
                        dataIndex: 'handle',
                        key: 'handle',
                        render: (handle: string, row: any) => (
                          <div className="flex items-center gap-3">
                            {row.avatarUrl ? (
                              <img src={row.avatarUrl} alt={row.nickname || handle} className="h-9 w-9 rounded-full object-cover shrink-0 border border-zinc-800" />
                            ) : (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 font-bold text-brand-300">
                                {handle.slice(1, 3).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-zinc-200 truncate">{row.nickname || handle.slice(1)}</div>
                              {row.crawlError ? (
                                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-500 font-semibold max-w-[240px] truncate" title={row.crawlError}>
                                  <ShieldAlert size={10} className="shrink-0" />
                                  <span>{row.crawlError}</span>
                                </div>
                              ) : row.signature ? (
                                <div className="text-[10px] text-zinc-500 truncate max-w-[200px]" title={row.signature}>
                                  {row.signature}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-zinc-500 font-mono">{handle}</div>
                            </div>
                          </div>
                        ),
                      },
                      {
                        title: '主页 URL',
                        dataIndex: 'homepageUrl',
                        key: 'homepageUrl',
                        render: (url: string) => (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-brand-400 max-w-[240px] truncate"
                          >
                            <span className="truncate">{url}</span>
                            <ExternalLink size={12} className="shrink-0" />
                          </a>
                        ),
                      },
                      {
                        title: '数据更新时间',
                        dataIndex: 'lastCrawledAt',
                        key: 'lastCrawledAt',
                        render: (t?: number) => (
                          <span className="text-xs text-zinc-400">
                            {t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '正在抓取初始化...'}
                          </span>
                        ),
                      },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        key: 'status',
                        render: (status: string) => (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                            监控中
                          </span>
                        ),
                      },
                      {
                        title: '操作',
                        key: 'actions',
                        align: 'center',
                        width: 200,
                        render: (_, row: any) => (
                          <Space size="middle">
                            <Button
                              type="text"
                              size="small"
                              icon={<Film size={12} />}
                              onClick={() => {
                                setPreviewBloggerId(row.id);
                                setPreviewBloggerName(row.nickname || row.handle);
                              }}
                              className="text-brand-400 hover:text-brand-300 hover:bg-brand-500/5 text-xs font-medium"
                            >
                              查看视频库
                            </Button>
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<Trash2 size={12} />}
                              onClick={() => {
                                modal.confirm({
                                  title: '确认删除博主',
                                  content: `您确定要删除监控博主「${row.handle}」吗？这会同时清空该博主已采集视频库。`,
                                  okText: '确认删除',
                                  okType: 'danger',
                                  onOk: () => deleteBloggerMutation.mutate(row.id),
                                });
                              }}
                              className="text-zinc-500 hover:text-red-400 hover:bg-red-500/5 text-xs"
                            >
                              删除
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* CRAWLER SETTINGS MODAL */}
      <Modal
        title={
          <div className="text-zinc-200 font-semibold text-lg flex items-center gap-2">
            <RefreshCw size={18} className="text-brand-400 animate-spin" />
            <span>TikTok 爬虫与账号登录设置</span>
          </div>
        }
        open={isSettingsOpen}
        onCancel={() => setIsSettingsOpen(false)}
        footer={null}
        width={560}
        destroyOnClose
        className="dark-modal"
      >
        <div className="mt-4 space-y-4 text-zinc-300">
          {/* SOCKS5 Proxy Status */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                SOCKS5 代理状态 (ALL_PROXY)
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                crawlerSettings?.proxy
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500'
              }`}>
                {crawlerSettings?.proxy ? '已配置代理' : '未配置代理 (直连)'}
              </span>
            </div>
            <div className="mt-2 text-xs text-zinc-300 font-mono break-all bg-zinc-950 p-2 border border-zinc-900 rounded">
              {crawlerSettings?.proxy || 'DIRECT (直连，无代理配置)'}
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-500 leading-normal">
              代理地址配置在服务器环境/本地的 <code>ALL_PROXY</code> 环境变量中，用于规避 TikTok 对同一 IP 频繁访问的速率限制或屏蔽。
            </p>
          </div>

          {/* Browser Cookie Integration */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                本地浏览器 Cookie 共享
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                crawlerSettings?.cookiesFromBrowser
                  ? 'bg-blue-500/10 border-blue-500/25 text-blue-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500'
              }`}>
                {crawlerSettings?.cookiesFromBrowser ? `已启用 (${crawlerSettings.cookiesFromBrowser})` : '未启用'}
              </span>
            </div>
            {crawlerSettings?.cookiesFromBrowser ? (
              <div className="mt-2 text-xs text-zinc-300 bg-zinc-950 p-2 border border-zinc-900 rounded">
                正在自动从本地电脑的 <strong>{crawlerSettings.cookiesFromBrowser}</strong> 浏览器中共享 TikTok 的登录 Cookies，无需手动管理。
              </div>
            ) : (
              <div className="mt-2 text-xs text-zinc-500">
                本地开发时可在 <code>.env</code> 中配置 <code>TIKTOK_COOKIES_FROM_BROWSER=chrome</code> 自动共享 Chrome 的登录状态。
              </div>
            )}
          </div>

          {/* Import cookies.txt file */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                TikTok 登录 Cookies (Netscape 格式)
              </label>
              {crawlerSettings?.hasCustomCookiesFile && (
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  📄 cookies.txt 已生效
                </span>
              )}
            </div>
            
            <Input.TextArea
              value={settingsCookiesText}
              onChange={(e) => setSettingsCookiesText(e.target.value)}
              rows={6}
              placeholder={`# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t1779873459\tsessionid\txxxxxx...`}
              className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            
            <div className="text-[11px] text-zinc-500 leading-relaxed">
              <strong>使用方法：</strong>
              <ol className="list-decimal pl-4 space-y-0.5 mt-1">
                <li>在浏览器中登录 TikTok 账号。</li>
                <li>使用浏览器插件（如 <span className="text-zinc-400">Get cookies.txt LOCALLY</span> 或其他 Cookie 导出工具）导出 <code>.tiktok.com</code> 域名下的 Netscape 格式 cookies。</li>
                <li>将导出的文本复制粘贴到上方输入框中，点击保存。系统将写入服务端的 <code>cookies.txt</code> 并同步至云端。</li>
              </ol>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-850">
            <Button
              onClick={() => setIsSettingsOpen(false)}
              className="border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={saveSettingsMutation.isPending}
              onClick={() => saveSettingsMutation.mutate(settingsCookiesText)}
              className="bg-brand-600 hover:bg-brand-500 border-none text-white font-medium shadow-lg"
            >
              保存并同步
            </Button>
          </div>
        </div>
      </Modal>

      {/* ADD BLOGGER MODAL */}
      <Modal
        title={
          <div className="text-zinc-200 font-semibold text-lg flex items-center gap-2">
            <Plus size={18} className="text-brand-400" />
            <span>录入 TikTok 监控博主</span>
          </div>
        }
        open={isAddBloggerOpen}
        onCancel={() => {
          setIsAddBloggerOpen(false);
          setBloggerUrl('');
        }}
        footer={null}
        width={480}
        destroyOnClose
        className="dark-modal"
      >
        <div className="mt-4 space-y-4 text-zinc-300">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              TikTok 个人主页链接
            </label>
            <Input
              value={bloggerUrl}
              onChange={(e) => setBloggerUrl(e.target.value)}
              placeholder="https://www.tiktok.com/@username"
              className="bg-zinc-900 border-zinc-800 text-zinc-100 hover:border-brand-500 focus:border-brand-500"
            />
            <p className="mt-2 text-[11px] text-zinc-500 leading-normal">
              例如: <code>https://www.tiktok.com/@bellapoarch</code>。系统会自动在后台调用第三方开源视频下载引擎对该博主发布的最新视频进行无水合元数据拉取和本地转存。
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-850">
            <Button
              onClick={() => {
                setIsAddBloggerOpen(false);
                setBloggerUrl('');
              }}
              className="border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={addBloggerMutation.isPending}
              onClick={handleAddBloggerSubmit}
              className="bg-brand-600 hover:bg-brand-500 border-none text-white"
            >
              保存并监控
            </Button>
          </div>
        </div>
      </Modal>

      {/* CREATE/EDIT STRATEGY DRAWER */}
      <Drawer
        title={
          <div className="text-zinc-200 font-semibold text-lg flex items-center gap-2">
            <Sparkles size={18} className="text-brand-400 animate-pulse" />
            <span>{editingStrategy ? '编辑做同款自动化策略' : '新建做同款自动化策略'}</span>
          </div>
        }
        open={isStrategyDrawerOpen}
        onClose={() => {
          setIsStrategyDrawerOpen(false);
          resetStrategyForm();
        }}
        width={620}
        destroyOnClose
        className="dark-drawer"
        footer={
          <div className="flex justify-end gap-2 px-2 py-3 border-t border-zinc-900 bg-zinc-950">
            <Button
              onClick={() => {
                setIsStrategyDrawerOpen(false);
                resetStrategyForm();
              }}
              className="border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={saveStrategyMutation.isPending}
              onClick={handleSaveStrategySubmit}
              className="bg-brand-600 hover:bg-brand-500 border-none text-white font-medium shadow-lg"
            >
              保存策略并上线
            </Button>
          </div>
        }
      >
        <div className="space-y-6 text-zinc-300 pb-16">
          {/* Strategy Name */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              策略名称
            </label>
            <Input
              value={stratName}
              onChange={(e) => setStratName(e.target.value)}
              placeholder="例如：@username 网红做同款 - 人设白裙御姐"
              className="bg-zinc-900 border-zinc-800 text-zinc-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Account selection */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                服务调用账户 (DashScope)
              </label>
              <Select
                value={stratAccountId}
                onChange={setStratAccountId}
                className="w-full bg-zinc-900 text-zinc-100"
                options={accounts.map((a) => ({ label: a.name, value: a.id }))}
                placeholder="请选择"
              />
            </div>
            
            {/* Strategy model type */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                同款生成模型模式
              </label>
              <Select
                value={stratType}
                onChange={setStratType}
                className="w-full bg-zinc-900 text-zinc-100"
                options={[
                  { label: 'Wan 2.7 Video Edit (视频编辑改写)', value: 'video_edit' },
                  { label: 'Wan 2.7 R2V (关键帧 Vision 智能剧本)', value: 'r2v' },
                ]}
              />
            </div>
          </div>

          {/* Blogger Selection */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>关联监控博主 (多选)</span>
              <span className="text-[10px] text-zinc-500 lowercase normal-case">该策略扫描以下博主的视频</span>
            </label>
            <Select
              mode="multiple"
              value={stratBloggerIds}
              onChange={setStratBloggerIds}
              className="w-full bg-zinc-900 text-zinc-100"
              placeholder="可选择监控库内的一个或多个 TK 博主"
              options={bloggers.map((b) => ({ label: `${b.nickname || b.handle.slice(1)} (${b.handle})`, value: b.id }))}
              maxTagCount="responsive"
            />
          </div>

          {/* Filtering strategy */}
          <div className="rounded-lg border border-zinc-850 bg-zinc-950/40 p-4 space-y-4">
            <h4 className="text-xs font-bold text-zinc-400 flex items-center gap-1.5 uppercase tracking-wider">
              <span>🔧 采集视频过滤策略</span>
            </h4>
            
            {/* Duration filter */}
            <div className="flex items-center justify-between gap-4">
              <Checkbox
                checked={useDurationFilter}
                onChange={(e) => setUseDurationFilter(e.target.checked)}
                className="text-xs text-zinc-300"
              >
                过滤视频时长限制 (秒)
              </Checkbox>
              {useDurationFilter && (
                <div className="flex items-center gap-2">
                  <InputNumber
                    min={0}
                    value={minDur}
                    onChange={(val) => setMinDur(val || 0)}
                    size="small"
                    className="w-16 bg-zinc-900 text-zinc-200 border-zinc-800"
                  />
                  <span className="text-zinc-500 text-xs">至</span>
                  <InputNumber
                    min={0}
                    value={maxDur}
                    onChange={(val) => setMaxDur(val || 10)}
                    size="small"
                    className="w-16 bg-zinc-900 text-zinc-200 border-zinc-800"
                  />
                  <span className="text-zinc-500 text-xs">秒</span>
                </div>
              )}
            </div>

            {/* Date filter */}
            <div className="flex items-center justify-between gap-4">
              <Checkbox
                checked={useDateFilter}
                onChange={(e) => setUseDateFilter(e.target.checked)}
                className="text-xs text-zinc-300"
              >
                发布时间在此日期之后
              </Checkbox>
              {useDateFilter && (
                <DatePicker
                  value={publishAfterDate}
                  onChange={(date) => setPublishAfterDate(date)}
                  size="small"
                  className="bg-zinc-900 border-zinc-800 text-zinc-200"
                  format="YYYY-MM-DD"
                />
              )}
            </div>

            {/* Playcount filter */}
            <div className="flex items-center justify-between gap-4">
              <Checkbox
                checked={usePlayFilter}
                onChange={(e) => setUsePlayFilter(e.target.checked)}
                className="text-xs text-zinc-300"
              >
                播放数据在指定值以上
              </Checkbox>
              {usePlayFilter && (
                <InputNumber
                  min={0}
                  value={minPlayCount}
                  onChange={(val) => setMinPlayCount(val || 0)}
                  size="small"
                  className="w-28 bg-zinc-900 text-zinc-200 border-zinc-800"
                  formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                />
              )}
            </div>

            {/* Deduplicate switch */}
            <div className="border-t border-zinc-900/60 pt-2 flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-300 font-semibold">去重机制开关</div>
                <div className="text-[10px] text-zinc-500">开启后同一个视频只做一次同款生成，关闭则每次轮询均会生成。</div>
              </div>
              <Checkbox
                checked={deduplicate}
                onChange={(e) => setDeduplicate(e.target.checked)}
              />
            </div>
          </div>

          {/* Persona Settings */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              👤 人设参数配置
            </h4>
            
            {/* Persona Avatar Reference Photo */}
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1.5 flex items-center justify-between">
                <span>人设参考图 (提供稳定脸部特征)</span>
                <span className="text-[10px] text-zinc-600">建议清晰的单人正面五官特写</span>
              </label>
              <div className="flex gap-3">
                <Input
                  value={refImageUrl}
                  onChange={(e) => setRefImageUrl(e.target.value)}
                  placeholder="在此输入参考图公网地址，或点击右侧上传"
                  className="flex-1 bg-zinc-900 border-zinc-800 text-zinc-100"
                />
                <Upload
                  customRequest={handleCustomUpload}
                  showUploadList={false}
                  accept="image/*"
                  disabled={isUploading}
                >
                  <Button
                    icon={isUploading ? <Loader2 className="animate-spin" size={14} /> : <ImageIcon size={14} />}
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 hover:text-brand-400 hover:border-brand-500"
                    disabled={isUploading}
                  >
                    {isUploading ? '上传中' : '本地上传'}
                  </Button>
                </Upload>
              </div>
              {refImageUrl && (
                <div className="mt-2 relative rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950 aspect-[16/9] max-w-[240px]">
                  <img src={refImageUrl} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setRefImageUrl('')}
                    className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-zinc-400 hover:text-white"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Persona Description */}
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1.5">
                人设形象补充说明 (AI 会在此描述基础上将原视频人设替换)
              </label>
              <Input.TextArea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                rows={3}
                placeholder="例如：'一个长发微卷、涂着深红色口红、身穿黑色吊带晚礼服的性感年轻亚裔女子'"
                className="bg-zinc-900 border-zinc-800 text-zinc-100"
              />
            </div>
          </div>

          {/* Style & Modify Configs */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              🎬 视频修改风格偏好
            </h4>

            <div>
              <label className="block text-[11px] text-zinc-400 mb-1.5 flex items-center justify-between">
                <span>粗略修改风格 (AI 风格改写)</span>
                <span className="text-[10px] text-zinc-500 font-normal">Grok 模型会将其润色后下发</span>
              </label>
              <Input.TextArea
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                rows={2}
                placeholder="例如：'在深夜霓虹的街头慢跑'，或者'雨天站在玻璃窗前眼神若有所思，整体色调昏暗带有胶片颗粒，光线柔和'"
                className="bg-zinc-900 border-zinc-800 text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Output Seed Count */}
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1.5">
                  生成结果个数 (不同 Seed)
                </label>
                <Select
                  value={outputCount}
                  onChange={setOutputCount}
                  className="w-full bg-zinc-900"
                  options={[
                    { label: '1 个结果', value: 1 },
                    { label: '2 个结果 (不同随机种子)', value: 2 },
                    { label: '3 个结果 (不同随机种子)', value: 3 },
                    { label: '4 个结果', value: 4 },
                    { label: '5 个结果 (多模型对比)', value: 5 },
                  ]}
                />
              </div>

              {/* Interval hours */}
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1.5">
                  后台自动执行时间间隔
                </label>
                <Select
                  value={intervalHours}
                  onChange={setIntervalHours}
                  className="w-full bg-zinc-900"
                  options={[
                    { label: '每 3 小时自动扫描采集', value: 3 },
                    { label: '每 6 小时自动扫描采集', value: 6 },
                    { label: '每 12 小时自动扫描采集', value: 12 },
                  ]}
                />
              </div>
            </div>

            {/* Audio Reuse checkbox */}
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-xs text-zinc-300 font-semibold">复用原视频音频</div>
                <div className="text-[10px] text-zinc-500">开启后，系统在模型渲染成功后，会自动用 ffmpeg 将原视频被裁剪段的音轨混合并替换至新生成的视频中。</div>
              </div>
              <Checkbox
                checked={reuseAudio}
                onChange={(e) => setReuseAudio(e.target.checked)}
              />
            </div>
          </div>

          {/* Folder Destination Configuration */}
          <div className="space-y-4 rounded-lg border border-zinc-850 bg-zinc-950/40 p-4">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>📂 任务输出归档文件夹</span>
            </h4>

            {/* Auto Create Folder Checkbox */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-zinc-300 font-semibold">自动创建独立文件夹</div>
                <div className="text-[10px] text-zinc-500">每次运行自动以「策略名称+运行时间」创建新文件夹并归档</div>
              </div>
              <Checkbox
                checked={autoCreateFolder}
                onChange={(e) => {
                  setAutoCreateFolder(e.target.checked);
                  if (e.target.checked) {
                    setDestFolderId(null);
                  }
                }}
              />
            </div>

            {/* Select Destination Folder (disabled if auto-create is checked) */}
            {!autoCreateFolder && (
              <div className="space-y-2">
                <label className="block text-[11px] text-zinc-400">
                  选择现有归档文件夹 (或新建文件夹)
                </label>
                <div className="flex gap-2">
                  <Select
                    value={destFolderId || undefined}
                    onChange={(val) => setDestFolderId(val || null)}
                    placeholder="选择文件夹，不选则进入默认“未分类”"
                    className="flex-1 bg-zinc-900 text-zinc-100"
                    allowClear
                    options={folders.map((f) => ({ label: f.name, value: f.id }))}
                  />
                  <Button
                    icon={<Plus size={14} />}
                    onClick={() => {
                      const name = window.prompt('请输入新文件夹名称：');
                      if (name && name.trim()) {
                        api.createFolder(name.trim()).then((f) => {
                          refetchFolders();
                          setDestFolderId(f.id);
                          message.success(`已创建并选择文件夹: ${name}`);
                        }).catch((err) => {
                          message.error('创建文件夹失败: ' + err.message);
                        });
                      }
                    }}
                    className="bg-zinc-800 border-zinc-700 text-zinc-200"
                  >
                    新建
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* EXECUTION LOGS DRAWER */}
      <Drawer
        title={
          <div className="text-zinc-200 font-semibold text-lg flex items-center gap-2">
            <Eye size={18} className="text-indigo-400" />
            <span>策略「{logStrategyName}」执行日志</span>
          </div>
        }
        open={logsDrawerOpen}
        onClose={() => {
          setLogsDrawerOpen(false);
          setLogStrategyId(null);
          setLogStrategyName('');
        }}
        width={720}
        className="dark-drawer"
      >
        {isLogsLoading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-zinc-500">
            <Loader2 className="animate-spin text-brand-400" size={32} />
            <span>加载执行日志中...</span>
          </div>
        ) : executionLogs.length === 0 ? (
          <div className="py-16 text-center text-zinc-500">
            <ShieldAlert size={32} className="mx-auto text-zinc-700 mb-3" />
            <p className="text-sm">暂无此策略的处理和下发日志记录。</p>
            <p className="text-xs text-zinc-650 mt-1">当定时轮询或者您手动触发“运行一次”后，这里将显示符合条件的采集视频和生成的同款任务。</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-zinc-500 mb-2">已记录 {executionLogs.length} 条做同款的处理历史：</div>
            <div className="space-y-3">
              {executionLogs.map((log, index) => (
                <div key={index} className="surface p-4 border border-zinc-850 bg-zinc-900/20 rounded-lg flex flex-col justify-between gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h5 className="text-xs font-semibold text-zinc-200 line-clamp-1">
                        原视频: {log.videoTitle || '未知视频标题'}
                      </h5>
                      <span className="text-[10px] text-zinc-500 font-mono">ID: {log.videoUniqueId}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                      {dayjs(log.processedAt).format('YYYY-MM-DD HH:mm:ss')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-900 pt-2 text-xs">
                    <div className="flex items-center gap-2">
                      {log.videoUrl && (
                        <a
                          href={log.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-brand-400"
                        >
                          TikTok 原视频 <ExternalLink size={10} />
                        </a>
                      )}
                      {log.downloadUrl && (
                        <a
                          href={log.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-brand-400"
                        >
                          转存 10s 裁剪版 <ExternalLink size={10} />
                        </a>
                      )}
                    </div>

                    <div>
                      {log.jobId ? (
                        <button
                          onClick={() => {
                            setLogsDrawerOpen(false);
                            navigate(`/tasks/${log.jobId}`);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400 hover:text-brand-300 cursor-pointer"
                        >
                          查看生成的任务 (Job) <ArrowRight size={10} />
                        </button>
                      ) : (
                        <span className="text-[11px] text-red-400">生成任务失败</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      {/* VIEW BLOGGER VIDEOS DRAWER */}
      <Drawer
        title={
          <div className="text-zinc-200 font-semibold text-lg flex items-center gap-2">
            <Film size={18} className="text-indigo-400 animate-pulse" />
            <span>博主「{previewBloggerName}」的已同步视频列表</span>
          </div>
        }
        open={!!previewBloggerId}
        onClose={() => {
          setPreviewBloggerId(null);
          setPreviewBloggerName('');
        }}
        width={780}
        className="dark-drawer"
        destroyOnClose
      >
        {isBloggerVideosLoading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-zinc-500">
            <Loader2 className="animate-spin text-brand-400" size={32} />
            <span>加载视频元数据中...</span>
          </div>
        ) : bloggerVideos.length === 0 ? (
          <div className="py-16 text-center text-zinc-500">
            <ShieldAlert size={32} className="mx-auto text-zinc-700 mb-3" />
            <p className="text-sm">该博主下暂无已同步的视频元数据。</p>
            <p className="text-xs text-zinc-600 mt-1">系统已启动首次数据爬取。爬虫约在 10s 内拉取完视频预览，您可以稍后重新开启该面板查看。</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-zinc-500 mb-2">已从其主页获取前 {bloggerVideos.length} 个视频的预览（做同款时会按需执行真实裁剪）：</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {bloggerVideos.map((vid: any) => (
                <div key={vid.id} className="surface overflow-hidden border border-zinc-850 bg-zinc-900/10 rounded-lg flex flex-col">
                  {/* Video cover */}
                  <div className="relative aspect-[9/16] bg-zinc-950 overflow-hidden flex items-center justify-center border-b border-zinc-900">
                    {vid.coverUrl ? (
                      <img src={vid.coverUrl} alt={vid.title} className="w-full h-full object-cover" />
                    ) : (
                      <Film size={28} className="text-zinc-700" />
                    )}
                    
                    {/* Duration badge bottom right */}
                    <div className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                      {vid.durationSec ? `${vid.durationSec.toFixed(1)}s` : '15.0s'}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-2.5 flex-1 flex flex-col justify-between gap-2.5">
                    <h5 className="text-[11px] font-semibold text-zinc-200 line-clamp-2 leading-relaxed" title={vid.title}>
                      {vid.title || '无标题视频'}
                    </h5>
                    
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-zinc-500">
                        <span>播放数</span>
                        <span className="text-zinc-300 font-mono">{(vid.playCount || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-zinc-500">
                        <span>发布时间</span>
                        <span className="text-zinc-400">{dayjs(vid.publishTime).format('MM-DD HH:mm')}</span>
                      </div>
                    </div>

                    <a
                      href={vid.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 w-full h-8 flex items-center justify-center gap-1 text-[10px] rounded border border-zinc-850 bg-zinc-950/45 text-zinc-400 hover:text-brand-400 hover:border-brand-500 transition-colors"
                    >
                      <span>原视频链接</span>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {hasMoreVideos && (
              <div className="pt-6 pb-8 text-center">
                <Button
                  onClick={() => loadMoreBloggerVideos(previewBloggerId!)}
                  loading={isLoadingMore}
                  type="default"
                  className="border-zinc-800 hover:border-brand-500 hover:text-brand-400 bg-zinc-900/20"
                >
                  {isLoadingMore ? '正在从 TikTok 抓取更早历史视频...' : '加载更多视频 (持续向前抓取)'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
