import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Modal, Drawer, Input, Select, Button, Upload, Slider, Checkbox } from 'antd';
import { Plus, Trash2, Sparkles, Image as ImageIcon, Film, Play, Loader2, ArrowRight, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import { useNavigate } from 'react-router-dom';

const R2V_MODELS = [
  {
    capabilityId: 'wan2.6.r2v',
    modelVariant: 'wan2.6-r2v',
    label: 'Wan 2.6 R2V (标准版)',
  },
  {
    capabilityId: 'wan2.6.r2v',
    modelVariant: 'wan2.6-r2v-flash',
    label: 'Wan 2.6 R2V Flash (极速版)',
  },
  {
    capabilityId: 'wan2.7.r2v',
    modelVariant: 'wan2.7-r2v',
    label: 'Wan 2.7 R2V (最新版)',
  },
];

interface GeneratedScript {
  title: string;
  prompt: string;
  duration: number;
  selected?: boolean;
}

export default function StrategiesPage() {
  const { message, modal } = AntApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const currentAccountId = useAppStore((s) => s.currentAccountId);
  
  // Queries
  const { data: strategies = [], isLoading: isStrategiesLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => api.listStrategies(),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.listAccounts().then((r) => r.accounts),
  });

  const currentAccountName = accounts.find((a) => a.id === currentAccountId)?.name || '未选择账户';

  // State: Create Strategy Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newStrategyName, setNewStrategyName] = useState('');
  const [newRefImageUrl, setNewRefImageUrl] = useState('');
  const [newPersona, setNewPersona] = useState('');
  const [newDuration, setNewDuration] = useState(10);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // State: Script Workspace Drawer
  const [activeStrategy, setActiveStrategy] = useState<any | null>(null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [generateCount, setGenerateCount] = useState(3);
  
  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStepMsg, setGenStepMsg] = useState('');
  const [generatedScripts, setGeneratedScripts] = useState<GeneratedScript[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  // Simulation of AI thinking steps
  useEffect(() => {
    if (!isGenerating) {
      setGenStepMsg('');
      return;
    }
    const steps = [
      '正在唤醒 Grok-beta 模型大语言大脑...',
      '正在深度解析参考角色人设设定...',
      '正在提取画面主视觉特征与场景张力模型...',
      '正在根据人设构思具有视觉冲突感的连贯分镜剧情...',
      '正在撰写 R2V 高质量英文镜头运行提示词 (含灯光、动作与运镜控制)...',
      'AI 正在优化生成并进行格式排版校验...'
    ];
    let stepIndex = 0;
    setGenStepMsg(steps[0]);

    const timer = setInterval(() => {
      if (stepIndex < steps.length - 1) {
        stepIndex++;
        setGenStepMsg(steps[stepIndex]);
      }
    }, 2800);

    return () => clearInterval(timer);
  }, [isGenerating]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (input: {
      name: string;
      refImageUrl: string;
      persona: string;
      duration: number;
      capabilityId: string;
      modelVariant: string;
    }) => api.createStrategy(input),
    onSuccess: () => {
      message.success('人设策略创建成功');
      setIsCreateOpen(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
    onError: (err: any) => {
      message.error(`创建失败: ${err.message || '未知错误'}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteStrategy(id),
    onSuccess: () => {
      message.success('策略已删除');
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
    onError: (err: any) => {
      message.error(`删除失败: ${err.message || '未知错误'}`);
    },
  });

  const resetCreateForm = () => {
    setNewStrategyName('');
    setNewRefImageUrl('');
    setNewPersona('');
    setNewDuration(10);
    setSelectedModelIndex(0);
  };

  const handleCustomUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    setIsUploading(true);
    try {
      const res = await api.uploadFile(file as File);
      setNewRefImageUrl(res.publicUrl);
      onSuccess(res);
      message.success('图片上传成功，已填入参考图');
    } catch (err: any) {
      onError(err);
      message.error(`上传失败: ${err.message || '未知原因'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateSubmit = () => {
    if (!newStrategyName.trim()) {
      message.warning('请输入策略名称');
      return;
    }
    if (!newRefImageUrl.trim()) {
      message.warning('请提供参考图 URL 或上传本地图片');
      return;
    }
    if (!newPersona.trim()) {
      message.warning('请输入详细人设描述');
      return;
    }

    const model = R2V_MODELS[selectedModelIndex];
    createMutation.mutate({
      name: newStrategyName,
      refImageUrl: newRefImageUrl,
      persona: newPersona,
      duration: newDuration,
      capabilityId: model.capabilityId,
      modelVariant: model.modelVariant,
    });
  };

  const handleDelete = (id: string, name: string) => {
    modal.confirm({
      title: '确认删除策略',
      content: `你确定要删除策略「${name}」吗？删除后将不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteMutation.mutate(id);
      },
    });
  };

  // Open script workspace for a strategy
  const openWorkspace = (strategy: any) => {
    setActiveStrategy(strategy);
    setGeneratedScripts([]);
    setGenerateCount(3);
    setIsGenerateOpen(true);
  };

  // Generate scripts using Grok
  const handleGenerate = async () => {
    if (!activeStrategy) return;
    setIsGenerating(true);
    setGeneratedScripts([]);
    try {
      const res = await api.generateStrategyScripts(activeStrategy.id, generateCount);
      const scripts = res.scripts.map((s) => ({ ...s, selected: true }));
      setGeneratedScripts(scripts);
      message.success(`成功生成 ${scripts.length} 个分镜剧本！`);
    } catch (err: any) {
      message.error(`Grok 生成失败: ${err.message || 'LLM 调用出错'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Execute batch generation
  const handleExecute = async () => {
    if (!activeStrategy) return;
    if (!currentAccountId) {
      message.warning('请先在顶部导航栏选择 DashScope 账户');
      return;
    }
    const selectedPrompts = generatedScripts.filter((s) => s.selected);
    if (selectedPrompts.length === 0) {
      message.warning('请至少勾选一个分镜剧本下发任务');
      return;
    }

    setIsExecuting(true);
    try {
      const res = await api.executeStrategy(activeStrategy.id, {
        accountId: currentAccountId,
        prompts: selectedPrompts.map((p) => ({ title: p.title, prompt: p.prompt })),
      });
      
      message.success(`一键成功下发 ${res.jobIds.length} 个视频生成任务！`);
      setIsGenerateOpen(false);
      
      modal.success({
        title: '任务下发成功',
        content: `已成功创建 ${res.jobIds.length} 个视频渲染任务，全部任务已挂载至队列系统。`,
        okText: '去队列中心查看',
        onOk: () => {
          navigate('/queue');
        },
      });
    } catch (err: any) {
      message.error(`批量下发任务失败: ${err.message || '内部请求错误'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const toggleSelectScript = (index: number) => {
    setGeneratedScripts((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, selected: !s.selected } : s))
    );
  };

  const handleUpdateScriptPrompt = (index: number, newPrompt: string) => {
    setGeneratedScripts((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, prompt: newPrompt } : s))
    );
  };

  const handleUpdateScriptTitle = (index: number, newTitle: string) => {
    setGeneratedScripts((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, title: newTitle } : s))
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="bg-gradient-to-r from-brand-400 to-indigo-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            人设策略自动化流水线
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            预设人设角色与视觉参考图，通过 Grok AI 自动构建丰富连贯的分镜动作脚本，一键批量下发视频队列进行全自动生产。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="primary"
            icon={<Plus size={16} />}
            onClick={() => setIsCreateOpen(true)}
            className="!h-10 bg-brand-600 hover:bg-brand-500 border-none font-medium text-white shadow-lg shadow-brand-500/20"
          >
            新建策略预设
          </Button>
        </div>
      </div>

      {/* Strategies List */}
      {isStrategiesLoading ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-zinc-500">
          <Loader2 className="animate-spin text-brand-400" size={32} />
          <span>正在加载策略库…</span>
        </div>
      ) : strategies.length === 0 ? (
        <div className="glass-panel flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-600">
            <Film size={28} />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">暂无自动化人设策略</h3>
          <p className="mt-2 max-w-md text-sm text-zinc-500">
            新建一个人设策略，配置好它的视觉参考图和角色属性，大模型就会为你源源不断地生成带故事动作的视频脚本。
          </p>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            onClick={() => setIsCreateOpen(true)}
            className="mt-6 bg-brand-600 hover:bg-brand-500 border-none text-white"
          >
            立即创建第一个策略
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {strategies.map((strategy: any, idx: number) => {
            const modelLabel =
              R2V_MODELS.find(
                (m) =>
                  m.capabilityId === strategy.capabilityId &&
                  m.modelVariant === strategy.modelVariant
              )?.label || `${strategy.modelVariant}`;

            return (
              <motion.div
                key={strategy.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
                className="surface surface-hover flex flex-col overflow-hidden border border-zinc-800 bg-zinc-900/40 shadow-xl"
              >
                {/* Visual Header / Reference Image */}
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-950">
                  <img
                    src={strategy.refImageUrl}
                    alt={strategy.name}
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4">
                    <span className="inline-flex items-center rounded-md bg-brand-500/10 px-2 py-0.5 text-xs font-semibold text-brand-300 ring-1 ring-inset ring-brand-500/30">
                      R2V {strategy.duration}秒
                    </span>
                    <h3 className="mt-1 text-lg font-bold text-zinc-100 truncate">
                      {strategy.name}
                    </h3>
                  </div>
                </div>

                {/* Card Content */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-4 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      角色设定 & 画面基调
                    </div>
                    <div className="mt-1.5 line-clamp-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-xs text-zinc-300 leading-relaxed italic">
                      “ {strategy.persona} ”
                    </div>
                  </div>

                  <div className="mb-4 border-t border-zinc-800/80 pt-3">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>生成模型</span>
                      <span className="font-medium text-zinc-300 truncate max-w-[160px]">
                        {modelLabel}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      type="primary"
                      icon={<Sparkles size={14} />}
                      onClick={() => openWorkspace(strategy)}
                      className="flex-1 !h-9 bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 border-none font-medium text-white"
                    >
                      智能生成分镜
                    </Button>
                    <Button
                      type="text"
                      danger
                      icon={<Trash2 size={14} />}
                      onClick={() => handleDelete(strategy.id, strategy.name)}
                      className="!h-9 !w-9 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* CREATE STRATEGY MODAL */}
      <Modal
        title={
          <div className="text-zinc-200 font-semibold text-lg flex items-center gap-2">
            <Plus size={18} className="text-brand-400" />
            <span>新建人设策略预设</span>
          </div>
        }
        open={isCreateOpen}
        onCancel={() => setIsCreateOpen(false)}
        footer={null}
        width={580}
        destroyOnClose
        className="dark-modal"
      >
        <div className="mt-4 space-y-5 text-zinc-300">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              策略名称
            </label>
            <Input
              value={newStrategyName}
              onChange={(e) => setNewStrategyName(e.target.value)}
              placeholder="例如：国风竹林剑客、赛博朋克摩托姬"
              className="bg-zinc-900 border-zinc-800 text-zinc-100 hover:border-brand-500 focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              角色参考图 (R2V 核心画面锚点)
            </label>
            <div className="flex gap-3">
              <Input
                value={newRefImageUrl}
                onChange={(e) => setNewRefImageUrl(e.target.value)}
                placeholder="在此输入参考图 HTTP/HTTPS 公网地址，或点击右侧上传文件"
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
                  {isUploading ? '上传中' : '上传本地'}
                </Button>
              </Upload>
            </div>
            {newRefImageUrl && (
              <div className="mt-2 relative rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950 aspect-[16/9] max-w-[280px]">
                <img src={newRefImageUrl} alt="Preview" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setNewRefImageUrl('')}
                  className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-zinc-400 hover:text-white"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              人物设定与场景风格 (Prompt 生成约束)
            </label>
            <Input.TextArea
              value={newPersona}
              onChange={(e) => setNewPersona(e.target.value)}
              rows={4}
              placeholder="请输入对于角色的人设描述，例如：
一名身穿银白发光贴身战衣的银发女战士，手持能量光刃，长相精致冷傲，周围有霓虹灯光和雨水，赛博朋克夜市风格。R2V 会以此人设为核心，通过 Grok 自动发散各种打斗、跳跃、凝视等不同动作镜头的描述词。"
              className="bg-zinc-900 border-zinc-800 text-zinc-100 hover:border-brand-500 focus:border-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                每段视频长度 (秒)
              </label>
              <Select
                value={newDuration}
                onChange={setNewDuration}
                options={[
                  { value: 5, label: '5 秒' },
                  { value: 10, label: '10 秒' },
                ]}
                className="w-full bg-zinc-900 border-zinc-800 text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                目标 R2V 渲染模型
              </label>
              <Select
                value={selectedModelIndex}
                onChange={setSelectedModelIndex}
                options={R2V_MODELS.map((m, idx) => ({ value: idx, label: m.label }))}
                className="w-full bg-zinc-900 border-zinc-800 text-zinc-100"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800 flex justify-end gap-2">
            <Button
              onClick={() => setIsCreateOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100"
            >
              取消
            </Button>
            <Button
              type="primary"
              onClick={handleCreateSubmit}
              loading={createMutation.isPending}
              className="bg-brand-600 hover:bg-brand-500 border-none text-white"
            >
              立即创建
            </Button>
          </div>
        </div>
      </Modal>

      {/* SCRIPT WORKSPACE DRAWER */}
      <Drawer
        title={
          activeStrategy ? (
            <div className="flex items-center gap-3">
              <img
                src={activeStrategy.refImageUrl}
                alt=""
                className="h-8 w-8 rounded object-cover border border-zinc-800"
              />
              <div>
                <div className="text-zinc-200 font-bold text-sm">{activeStrategy.name}</div>
                <div className="text-[10px] text-zinc-500">剧本自动化生成工作台</div>
              </div>
            </div>
          ) : (
            '剧本自动化生成'
          )
        }
        placement="right"
        width={720}
        onClose={() => setIsGenerateOpen(false)}
        open={isGenerateOpen}
        destroyOnClose
        className="dark-drawer"
        bodyStyle={{ display: 'flex', flexDirection: 'column', backgroundColor: '#09090b', padding: '20px' }}
        headerStyle={{ borderBottom: '1px solid #18181b', backgroundColor: '#09090b' }}
      >
        {activeStrategy && (
          <div className="flex flex-col flex-1 h-full text-zinc-300 overflow-hidden">
            {/* Generate Controller */}
            <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  分镜脚本生成设定
                </span>
                <span className="text-xs text-zinc-500">
                  当前账户: <strong className="text-zinc-300">{currentAccountName}</strong>
                </span>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1.5 text-zinc-400">
                    <span>生成分镜场景数量</span>
                    <span className="font-bold text-brand-400">{generateCount} 个分镜</span>
                  </div>
                  <Slider
                    min={1}
                    max={10}
                    value={generateCount}
                    onChange={setGenerateCount}
                    disabled={isGenerating}
                  />
                </div>
                <Button
                  type="primary"
                  icon={isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                  onClick={handleGenerate}
                  disabled={isGenerating || isExecuting}
                  className="bg-brand-600 hover:bg-brand-500 border-none h-10 px-5 text-white font-medium shadow-md shadow-brand-500/10 shrink-0"
                >
                  {isGenerating ? 'AI 剧本生成中...' : 'Grok 智能生成剧本'}
                </Button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto mb-4 pr-1 min-h-0">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="relative mb-6 flex h-16 w-16 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500/20 opacity-75"></span>
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 border border-brand-500/30 text-brand-400">
                      <Sparkles size={20} className="animate-pulse" />
                    </div>
                  </div>
                  <h4 className="text-base font-semibold text-zinc-200">Grok 大模型正在全力创作</h4>
                  <p className="mt-2 text-xs text-brand-400 max-w-sm font-mono h-8 flex items-center justify-center text-center">
                    {genStepMsg}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    (这需要大约 10-15 秒的时间，请稍候...)
                  </p>
                </div>
              ) : generatedScripts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600">
                    <Sparkles size={22} />
                  </div>
                  <h4 className="text-sm font-medium text-zinc-300">智能分镜剧本库尚空</h4>
                  <p className="mt-1 max-w-xs text-xs text-zinc-500">
                    在上方选择数量并点击“Grok 智能生成剧本”以让大语言模型自动分析人设和画面要求。
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
                    <span>
                      生成完成！共 {generatedScripts.length} 个分镜剧本（已选中{' '}
                      {generatedScripts.filter((s) => s.selected).length} 个）
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setGeneratedScripts((prev) => prev.map((s) => ({ ...s, selected: true })))}
                        className="text-brand-400 hover:underline text-[11px]"
                      >
                        全选
                      </button>
                      <span>|</span>
                      <button
                        onClick={() => setGeneratedScripts((prev) => prev.map((s) => ({ ...s, selected: false })))}
                        className="text-zinc-500 hover:underline text-[11px]"
                      >
                        全不选
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {generatedScripts.map((script, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className={`rounded-xl border p-4 transition-all duration-200 ${
                          script.selected
                            ? 'border-brand-500/40 bg-brand-500/5'
                            : 'border-zinc-800 bg-zinc-900/20 opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => toggleSelectScript(idx)}
                            className="mt-1 text-zinc-400 hover:text-brand-400 transition-colors"
                          >
                            {script.selected ? (
                              <CheckSquare size={18} className="text-brand-400" />
                            ) : (
                              <Square size={18} />
                            )}
                          </button>
                          
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center justify-between gap-4">
                              <Input
                                value={script.title}
                                onChange={(e) => handleUpdateScriptTitle(idx, e.target.value)}
                                className="bg-transparent border-none px-0 text-sm font-semibold text-zinc-200 focus:bg-zinc-800/40 focus:px-2 rounded hover:bg-zinc-800/20"
                                placeholder="分镜中文概述"
                              />
                              <span className="text-[10px] bg-zinc-800/80 px-2 py-0.5 rounded text-zinc-400 shrink-0">
                                分镜 {idx + 1} • {script.duration}秒
                              </span>
                            </div>

                            <div>
                              <div className="text-[10px] text-zinc-500 font-semibold uppercase mb-1">
                                R2V 渲染提示词 (Grok 英文生成，可手动微调)
                              </div>
                              <Input.TextArea
                                value={script.prompt}
                                onChange={(e) => handleUpdateScriptPrompt(idx, e.target.value)}
                                rows={3}
                                className="bg-zinc-950 border-zinc-800 text-zinc-300 text-xs leading-relaxed focus:border-brand-500"
                                placeholder="请输入 R2V 渲染提示词"
                              />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Execute Footer */}
            {generatedScripts.length > 0 && !isGenerating && (
              <div className="border-t border-zinc-800 pt-4 mt-auto shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-[#09090b]">
                <div className="text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <span className="status-dot bg-brand-400 animate-pulse"></span>
                    使用账户：<strong className="text-zinc-200">{currentAccountName}</strong>
                  </span>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    若需切换账户，请点击页面右上角账户选择器。
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    onClick={() => setIsGenerateOpen(false)}
                    className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100"
                  >
                    关闭
                  </Button>
                  <Button
                    type="primary"
                    icon={<Play size={14} />}
                    onClick={handleExecute}
                    loading={isExecuting}
                    disabled={generatedScripts.filter((s) => s.selected).length === 0}
                    className="bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 border-none text-white font-medium shadow-lg shadow-brand-500/20"
                  >
                    一键批量执行 ({generatedScripts.filter((s) => s.selected).length} 个任务)
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
