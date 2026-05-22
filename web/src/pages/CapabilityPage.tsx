import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { App as AntApp, Button, Input, Select, Collapse, Popconfirm } from 'antd';
import { Play, BookOpen, Layers, FileText, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useCapabilities } from '../App';
import { useAppStore } from '../lib/store';
import { api } from '../lib/api';
import type { BatchMatrix, MediaInput } from '@bvp/shared';
import ParamPanel from '../components/ParamPanel';
import MediaInputBoard from '../components/MediaInputBoard';
import BatchMatrixDesigner from '../components/BatchMatrixDesigner';

export default function CapabilityPage() {
  const { capabilityId } = useParams<{ capabilityId: string }>();
  const { data: capabilities = [] } = useCapabilities();
  const cap = capabilities.find((c) => c.id === capabilityId);
  const navigate = useNavigate();
  const { message, notification } = AntApp.useApp();
  const accountId = useAppStore((s) => s.currentAccountId);
  const qc = useQueryClient();

  const capabilityForms = useAppStore((s) => s.capabilityForms);
  const setCapabilityForm = useAppStore((s) => s.setCapabilityForm);

  const defaultModel = cap?.models.find((m) => m.default)?.value ?? cap?.models[0]?.value ?? '';
  const formData = (capabilityId && capabilityForms[capabilityId]) || {};

  const modelVariant = formData.modelVariant ?? defaultModel;
  const prompt = formData.prompt ?? '';
  const negativePrompt = formData.negativePrompt ?? '';
  const media = (formData.media as MediaInput[]) ?? [];
  const parameters = (formData.parameters as Record<string, unknown>) ?? {};
  const matrix = (formData.matrix as BatchMatrix) ?? { axes: [] };
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!capabilityId || !cap) return;
    const existing = useAppStore.getState().capabilityForms[capabilityId];
    if (!existing) {
      setCapabilityForm(capabilityId, {
        modelVariant: cap.models.find((m) => m.default)?.value ?? cap.models[0]?.value ?? '',
        prompt: '',
        negativePrompt: '',
        media: [],
        parameters: Object.fromEntries(
          cap.parameterSpec
            .filter((f) => f.default !== undefined)
            .map((f) => [f.key, f.default])
        ),
        matrix: { axes: [] }
      });
    } else {
      const updates: any = {};
      if (existing.modelVariant === undefined) {
        updates.modelVariant = cap.models.find((m) => m.default)?.value ?? cap.models[0]?.value ?? '';
      }
      if (existing.prompt === undefined) {
        updates.prompt = '';
      }
      if (existing.negativePrompt === undefined) {
        updates.negativePrompt = '';
      }
      if (existing.media === undefined) {
        updates.media = [];
      }
      if (existing.parameters === undefined) {
        updates.parameters = Object.fromEntries(
          cap.parameterSpec
            .filter((f) => f.default !== undefined)
            .map((f) => [f.key, f.default])
        );
      }
      if (existing.matrix === undefined) {
        updates.matrix = { axes: [] };
      }
      if (Object.keys(updates).length > 0) {
        setCapabilityForm(capabilityId, updates);
      }
    }
  }, [capabilityId, cap, setCapabilityForm]);

  const total = useMemo(() => {
    if (matrix.axes.length === 0) return 1;
    return matrix.axes.reduce((acc, ax) => acc * Math.max(1, ax.values.length), 1);
  }, [matrix.axes]);

  if (!cap) {
    return <div className="p-6 text-zinc-500">未找到该能力</div>;
  }

  function resetForm() {
    if (!capabilityId || !cap) return;
    setCapabilityForm(capabilityId, {
      modelVariant: cap.models.find((m) => m.default)?.value ?? cap.models[0]?.value ?? '',
      prompt: '',
      negativePrompt: '',
      media: [],
      parameters: Object.fromEntries(
        cap.parameterSpec
          .filter((f) => f.default !== undefined)
          .map((f) => [f.key, f.default])
      ),
      matrix: { axes: [] }
    });
    message.success('已清空当前工作台所有配置参数');
  }

  async function submit() {
    if (!accountId) {
      message.warning('请先选择账户');
      return;
    }
    if (cap!.promptSpec.required && !prompt.trim()) {
      message.warning('请填写提示词');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createJob({
        accountId,
        capabilityId: cap!.id,
        modelVariant,
        basePrompt: prompt || undefined,
        baseNegativePrompt: negativePrompt || undefined,
        baseMedia: media,
        baseParameters: parameters,
        batchMatrix: matrix,
      });
      notification.success({
        message: '已提交',
        description: `Job ${result.jobId.slice(0, 8)} — ${result.total} 个子任务`,
      });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{cap.displayName}</h1>
            <p className="mt-1 text-sm text-zinc-500">{cap.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">模型</span>
            <Select
              size="middle"
              value={modelVariant}
              onChange={(val) => setCapabilityForm(capabilityId!, { modelVariant: val })}
              options={cap.models.map((m) => ({ value: m.value, label: m.label }))}
              className="min-w-[200px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <Section title="提示词" icon={<FileText size={16} />}>
              <Input.TextArea
                value={prompt}
                onChange={(e) => setCapabilityForm(capabilityId!, { prompt: e.target.value })}
                placeholder={
                  cap.promptSpec.syntaxHelp ?? '描述你希望生成的内容…'
                }
                rows={4}
                maxLength={cap.promptSpec.maxChars}
                showCount
              />
              {cap.promptSpec.supportsNegative && (
                <div className="mt-3">
                  <Input.TextArea
                    value={negativePrompt}
                    onChange={(e) => setCapabilityForm(capabilityId!, { negativePrompt: e.target.value })}
                    placeholder="反向提示词 (negative prompt)"
                    rows={2}
                    maxLength={500}
                  />
                </div>
              )}
              {cap.promptSpec.syntaxHelp && (
                <div className="mt-2 text-xs text-zinc-500">{cap.promptSpec.syntaxHelp}</div>
              )}
            </Section>

            {cap.mediaSpec.mode !== 'none' && (
              <Section title="媒体输入">
                <MediaInputBoard
                  capability={cap}
                  value={media}
                  onChange={(next) => setCapabilityForm(capabilityId!, { media: next })}
                />
              </Section>
            )}

            <Section title="参数">
              <ParamPanel
                capability={cap}
                modelVariant={modelVariant}
                values={parameters}
                onChange={(next) => setCapabilityForm(capabilityId!, { parameters: next })}
              />
            </Section>
          </div>

          <div className="space-y-5">
            <Section
              title="生成数量与变化"
              icon={<Layers size={16} />}
              hint="默认生成 1 个。想一次出多个版本？选一个常用模式即可。"
            >
              <BatchMatrixDesigner
                capability={cap}
                modelVariant={modelVariant}
                value={matrix}
                onChange={(next) => setCapabilityForm(capabilityId!, { matrix: next })}
                basePrompt={prompt}
              />
            </Section>

            <Collapse
              ghost
              items={[
                {
                  key: 'guide',
                  label: (
                    <span className="flex items-center gap-2 text-zinc-300">
                      <BookOpen size={14} /> 使用指南
                    </span>
                  ),
                  children: <UsageGuide capability={cap} />,
                },
              ]}
            />
          </div>
        </div>

        <div className="sticky bottom-0 left-0 right-0 mt-6 -mx-4 border-t border-zinc-900 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div className="text-sm text-zinc-400">
              将生成 <span className="font-mono text-base text-brand-300">{total}</span> 个子任务
            </div>
            <div className="flex items-center gap-3">
              <Popconfirm
                title="确定要清空当前工作台的所有配置吗？"
                description="清空后提示词和媒体文件需要重新配置。"
                onConfirm={resetForm}
                okText="确定清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  size="large"
                  icon={<RotateCcw size={15} />}
                  className="text-zinc-400 hover:text-red-400 hover:border-red-400/30 flex items-center justify-center"
                >
                  清空
                </Button>
              </Popconfirm>
              
              <Button
                type="primary"
                size="large"
                icon={<Play size={16} />}
                loading={submitting}
                onClick={submit}
                disabled={total > cap.batch.platformMaxFanout || !accountId}
              >
                提交
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Section({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon?: JSX.Element;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface p-4 sm:p-5">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          {icon}
          <span>{title}</span>
        </div>
        {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function UsageGuide({ capability }: { capability: { docPath: string; promptSpec: { syntaxHelp?: string } } }) {
  return (
    <div className="space-y-2 text-sm text-zinc-400">
      <div>详细参数与示例参见 <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">{capability.docPath}</code></div>
      {capability.promptSpec.syntaxHelp && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mb-1 text-xs uppercase tracking-wider text-zinc-500">Prompt 语法</div>
          <div className="text-sm">{capability.promptSpec.syntaxHelp}</div>
        </div>
      )}
      <div className="text-xs text-zinc-500">
        所有 DashScope 调用统一走新加坡站点，结果 URL 默认 24h 有效，请及时下载。
      </div>
    </div>
  );
}
