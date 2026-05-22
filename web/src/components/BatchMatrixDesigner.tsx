import { useMemo, useState } from 'react';
import { Input, Select, Tag, Button } from 'antd';
import { Plus, X, Dices, Maximize2, Clock, Type as TypeIcon, Settings2, Sparkles, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BatchAxis, BatchAxisValue, BatchMatrix, Capability, ParamField } from '@bvp/shared';

interface Props {
  capability: Capability;
  modelVariant: string;
  value: BatchMatrix;
  onChange: (next: BatchMatrix) => void;
  basePrompt?: string;
  baseNegativePrompt?: string;
}

function sweepableFields(cap: Capability): ParamField[] {
  return cap.parameterSpec.filter((f) => f.sweepable.allowed);
}

function findField(cap: Capability, key: string): ParamField | undefined {
  return cap.parameterSpec.find((f) => f.key === key);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function getEnumOptions(field: ParamField, modelVariant: string) {
  return field.enum?.filter((e) => !e.modelScope || e.modelScope.includes(modelVariant)) ?? [];
}

interface Preset {
  id: string;
  icon: JSX.Element;
  title: string;
  subtitle: string;
  count: number;
  buildAxis: () => BatchAxis;
}

function buildPresets(cap: Capability, modelVariant: string, basePrompt?: string, baseNegativePrompt?: string): Preset[] {
  const seedField = findField(cap, 'parameters.seed');
  const resolutionField =
    findField(cap, 'parameters.resolution') ??
    findField(cap, 'parameters.size');
  const durationField = findField(cap, 'parameters.duration');

  const presets: Preset[] = [];

  if (seedField) {
    presets.push({
      id: 'seeds-3',
      icon: <Dices size={18} />,
      title: '试 3 个 seed',
      subtitle: '同一 prompt 出 3 个不同结果',
      count: 3,
      buildAxis: () => ({
        name: 'parameters.seed',
        values: [randomSeed(), randomSeed(), randomSeed()].map((s) => ({
          label: `seed ${s}`,
          paramOverrides: { 'parameters.seed': s },
        })),
      }),
    });
  }

  if (resolutionField) {
    const options = getEnumOptions(resolutionField, modelVariant);
    if (options.length >= 2) {
      const pick =
        options.length <= 3
          ? options
          : options.filter((o) => /720|1080/.test(String(o.value))).slice(0, 2);
      const useList = pick.length >= 2 ? pick : options.slice(0, 2);
      presets.push({
        id: 'resolution-compare',
        icon: <Maximize2 size={18} />,
        title: '对比分辨率',
        subtitle: useList.map((o) => o.label).join(' / '),
        count: useList.length,
        buildAxis: () => ({
          name: resolutionField.key,
          values: useList.map((o) => ({
            label: String(o.label),
            paramOverrides: { [resolutionField.key]: o.value },
          })),
        }),
      });
    }
  }

  if (durationField && durationField.range) {
    const [min, max] = durationField.range;
    const mid = Math.round((min + max) / 2);
    const picks = Array.from(new Set([min, mid, max])).filter((v) => v >= min && v <= max);
    if (picks.length >= 2) {
      presets.push({
        id: 'duration-compare',
        icon: <Clock size={18} />,
        title: '不同时长',
        subtitle: picks.map((v) => `${v}s`).join(' / '),
        count: picks.length,
        buildAxis: () => ({
          name: durationField.key,
          values: picks.map((v) => ({
            label: `${v}s`,
            paramOverrides: { [durationField.key]: v },
          })),
        }),
      });
    }
  }

  presets.push({
    id: 'multi-prompt',
    icon: <TypeIcon size={18} />,
    title: '多个 prompt',
    subtitle: '同一参数下试不同描述',
    count: 2,
    buildAxis: () => ({
      name: '_prompt',
      values: [
        {
          label: 'Prompt 1',
          promptOverride: basePrompt ?? '',
          ...(cap.promptSpec.supportsNegative ? { negativePromptOverride: baseNegativePrompt ?? '' } : {}),
        },
        {
          label: 'Prompt 2',
          promptOverride: '',
          ...(cap.promptSpec.supportsNegative ? { negativePromptOverride: '' } : {}),
        },
      ],
    }),
  });

  return presets;
}

function axisDisplayName(axis: BatchAxis, cap: Capability): string {
  if (axis.name === '_prompt') return 'Prompt';
  const f = findField(cap, axis.name);
  return f?.label ?? axis.name;
}

function valueDisplay(v: BatchAxisValue): string {
  if (v.promptOverride !== undefined) {
    const t = v.promptOverride.trim();
    const promptStr = t ? (t.length > 25 ? t.slice(0, 25) + '…' : t) : '(空)';
    if (v.negativePromptOverride !== undefined) {
      const nt = v.negativePromptOverride.trim();
      const negStr = nt ? (nt.length > 15 ? nt.slice(0, 15) + '…' : nt) : '';
      return negStr ? `${promptStr} (反向: ${negStr})` : promptStr;
    }
    return promptStr;
  }
  if (v.paramOverrides) {
    const entry = Object.entries(v.paramOverrides)[0];
    if (entry) return `${entry[1]}`;
  }
  return v.label;
}

function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((prefix) => arr.map((v) => [...prefix, v])),
    [[]]
  );
}

export default function BatchMatrixDesigner({ capability, modelVariant, value, onChange, basePrompt, baseNegativePrompt }: Props) {
  const fields = sweepableFields(capability);
  const presets = useMemo(
    () => buildPresets(capability, modelVariant, basePrompt, baseNegativePrompt),
    [capability, modelVariant, basePrompt, baseNegativePrompt]
  );
  const [showCustom, setShowCustom] = useState(false);

  const usedFieldNames = new Set(value.axes.map((a) => a.name));

  const total = useMemo(() => {
    if (value.axes.length === 0) return 1;
    return value.axes.reduce((acc, ax) => acc * Math.max(1, ax.values.length), 1);
  }, [value.axes]);

  const isBatch = value.axes.length > 0;
  const overLimit = total > capability.batch.platformMaxFanout;

  // Live preview of cartesian combos
  const previewItems = useMemo(() => {
    if (value.axes.length === 0) return [{ idx: 0, parts: ['默认参数'] }];
    const grids = cartesian(value.axes.map((a) => a.values));
    return grids.slice(0, 6).map((coord, idx) => ({
      idx,
      parts: coord.map((v, i) => `${axisDisplayName(value.axes[i], capability)}: ${valueDisplay(v)}`),
    }));
  }, [value.axes, capability]);

  function applyPreset(preset: Preset) {
    const newAxis = preset.buildAxis();
    const existing = value.axes.filter((a) => a.name !== newAxis.name);
    onChange({ ...value, axes: [...existing, newAxis] });
    setShowCustom(false);
  }

  function addCustomAxis(field: ParamField) {
    const optionList = getEnumOptions(field, modelVariant);
    const initialValues: BatchAxisValue[] =
      optionList.length >= 2
        ? optionList.slice(0, 2).map((o) => ({
            label: String(o.label),
            paramOverrides: { [field.key]: o.value },
          }))
        : field.key === 'parameters.seed'
          ? [randomSeed(), randomSeed()].map((s) => ({
              label: `seed ${s}`,
              paramOverrides: { [field.key]: s },
            }))
          : [
              {
                label: '值 A',
                paramOverrides: field.range ? { [field.key]: field.range[0] } : { [field.key]: '' },
              },
              {
                label: '值 B',
                paramOverrides: field.range ? { [field.key]: field.range[1] } : { [field.key]: '' },
              },
            ];
    onChange({ ...value, axes: [...value.axes, { name: field.key, values: initialValues }] });
  }

  function addCustomPromptAxis() {
    onChange({
      ...value,
      axes: [
        ...value.axes,
        {
          name: '_prompt',
          values: [
            { label: 'Prompt 1', promptOverride: basePrompt ?? '' },
            { label: 'Prompt 2', promptOverride: '' },
          ],
        },
      ],
    });
  }

  function removeAxis(idx: number) {
    onChange({ ...value, axes: value.axes.filter((_, i) => i !== idx) });
  }

  function clearAll() {
    onChange({ ...value, axes: [] });
    setShowCustom(false);
  }

  function updateAxisValues(idx: number, next: BatchAxis['values']) {
    onChange({
      ...value,
      axes: value.axes.map((a, i) => (i === idx ? { ...a, values: next } : a)),
    });
  }

  function appendAxisValue(idx: number) {
    const axis = value.axes[idx];
    const field = findField(capability, axis.name);
    let next: BatchAxisValue;
    if (axis.name === '_prompt') {
      next = {
        label: `Prompt ${axis.values.length + 1}`,
        promptOverride: '',
        ...(capability.promptSpec.supportsNegative ? { negativePromptOverride: '' } : {}),
      };
    } else if (field?.key === 'parameters.seed') {
      const s = randomSeed();
      next = { label: `seed ${s}`, paramOverrides: { [field.key]: s } };
    } else if (field?.enum) {
      const opts = getEnumOptions(field, modelVariant);
      const used = new Set(axis.values.map((v) => v.paramOverrides?.[field.key]));
      const fresh = opts.find((o) => !used.has(o.value));
      next = {
        label: String(fresh?.label ?? `值 ${axis.values.length + 1}`),
        paramOverrides: { [field.key]: (fresh?.value ?? opts[0]?.value) as unknown },
      };
    } else if (field?.range) {
      next = { label: `值 ${axis.values.length + 1}`, paramOverrides: { [field.key]: field.range[0] } };
    } else {
      next = { label: `值 ${axis.values.length + 1}`, paramOverrides: { [axis.name]: '' } };
    }
    updateAxisValues(idx, [...axis.values, next]);
  }

  function removeAxisValue(axisIdx: number, valueIdx: number) {
    const axis = value.axes[axisIdx];
    if (axis.values.length <= 1) {
      removeAxis(axisIdx);
      return;
    }
    updateAxisValues(axisIdx, axis.values.filter((_, i) => i !== valueIdx));
  }

  return (
    <div className="space-y-4">
      {/* Mode summary banner */}
      <div
        className={`rounded-xl border px-4 py-3 transition-colors ${
          isBatch
            ? 'border-brand-500/40 bg-brand-500/10'
            : 'border-zinc-800 bg-zinc-900/40'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                isBatch ? 'bg-brand-500/20 text-brand-300' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              <Sparkles size={16} />
            </div>
            <div>
              <div className="text-sm font-medium">
                {isBatch ? (
                  <>
                    这次会生成{' '}
                    <span className={`font-mono ${overLimit ? 'text-rose-300' : 'text-brand-200'}`}>
                      {total}
                    </span>{' '}
                    个结果
                  </>
                ) : (
                  '这次只生成 1 个结果'
                )}
              </div>
              <div className="mt-0.5 text-xs text-zinc-400">
                {isBatch
                  ? '想改回单个？点右侧"全部清除"。'
                  : '想一次出多个版本？挑下面任意一个模式即可。'}
              </div>
            </div>
          </div>
          {isBatch && (
            <Button size="small" type="text" onClick={clearAll}>
              全部清除
            </Button>
          )}
        </div>
        {overLimit && (
          <div className="mt-2 rounded-md bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
            超过平台上限 {capability.batch.platformMaxFanout}，请减少一些值
          </div>
        )}
      </div>

      {/* Quick presets — always visible until user opens custom */}
      {!showCustom && (
        <div>
          <div className="mb-2 text-xs font-medium text-zinc-500">⚡ 常用模式（一键应用）</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="surface surface-hover group flex items-center gap-3 p-3 text-left"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-300">
                  {p.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="truncate text-xs text-zinc-500">{p.subtitle}</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-500 group-hover:text-brand-400">
                  <span>→ {p.count} 个</span>
                  <ChevronRight size={12} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active axes — shown when user has added any */}
      <AnimatePresence>
        {value.axes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            <div className="text-xs font-medium text-zinc-500">已添加的变化</div>
            {value.axes.map((axis, idx) => {
              const field = findField(capability, axis.name);
              const isPrompt = axis.name === '_prompt';
              return (
                <div key={`${axis.name}-${idx}`} className="surface p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {axisDisplayName(axis, capability)}
                      </span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {axis.values.length} 个值
                      </span>
                    </div>
                    <Button type="text" size="small" onClick={() => removeAxis(idx)} icon={<X size={14} />} />
                  </div>
                  <div className="space-y-1.5">
                    {axis.values.map((v, vIdx) => (
                      <div key={vIdx} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-zinc-600">#{vIdx + 1}</span>
                        <div className="flex-1">
                          {isPrompt ? (
                            <div className="space-y-1.5">
                              <Input.TextArea
                                size="small"
                                rows={2}
                                value={v.promptOverride}
                                onChange={(e) => {
                                  const next = [...axis.values];
                                  next[vIdx] = { ...v, promptOverride: e.target.value, label: `Prompt ${vIdx + 1}` };
                                  updateAxisValues(idx, next);
                                }}
                                placeholder="另一条 prompt…"
                              />
                              {capability.promptSpec.supportsNegative && (
                                <Input.TextArea
                                  size="small"
                                  rows={1}
                                  value={v.negativePromptOverride}
                                  onChange={(e) => {
                                    const next = [...axis.values];
                                    next[vIdx] = { ...v, negativePromptOverride: e.target.value };
                                    updateAxisValues(idx, next);
                                  }}
                                  placeholder="对应负面提示词（可选）…"
                                />
                              )}
                            </div>
                          ) : field?.enum ? (
                            <Select
                              size="small"
                              className="w-full"
                              value={v.paramOverrides?.[field.key] as string}
                              onChange={(newVal) => {
                                const next = [...axis.values];
                                const newLabel =
                                  String(
                                    field.enum?.find((e) => e.value === newVal)?.label ?? newVal
                                  );
                                next[vIdx] = {
                                  ...v,
                                  label: newLabel,
                                  paramOverrides: { ...v.paramOverrides, [field.key]: newVal },
                                };
                                updateAxisValues(idx, next);
                              }}
                              options={getEnumOptions(field, modelVariant).map((e) => ({
                                value: e.value as string | number,
                                label: e.label,
                              }))}
                            />
                          ) : field?.key === 'parameters.seed' ? (
                            <div className="flex gap-1">
                              <Input
                                size="small"
                                value={String(v.paramOverrides?.[field.key] ?? '')}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  const next = [...axis.values];
                                  next[vIdx] = {
                                    ...v,
                                    label: `seed ${num}`,
                                    paramOverrides: { ...v.paramOverrides, [field.key]: num },
                                  };
                                  updateAxisValues(idx, next);
                                }}
                              />
                              <Button
                                size="small"
                                icon={<Dices size={12} />}
                                onClick={() => {
                                  const s = randomSeed();
                                  const next = [...axis.values];
                                  next[vIdx] = {
                                    ...v,
                                    label: `seed ${s}`,
                                    paramOverrides: { ...v.paramOverrides, [field.key]: s },
                                  };
                                  updateAxisValues(idx, next);
                                }}
                              />
                            </div>
                          ) : (
                            <Input
                              size="small"
                              value={String(v.paramOverrides?.[axis.name] ?? '')}
                              onChange={(e) => {
                                const next = [...axis.values];
                                next[vIdx] = {
                                  ...v,
                                  paramOverrides: { ...v.paramOverrides, [axis.name]: e.target.value },
                                };
                                updateAxisValues(idx, next);
                              }}
                            />
                          )}
                        </div>
                        <Button
                          type="text"
                          size="small"
                          icon={<X size={12} />}
                          onClick={() => removeAxisValue(idx, vIdx)}
                        />
                      </div>
                    ))}
                    <Button
                      type="text"
                      size="small"
                      icon={<Plus size={14} />}
                      onClick={() => appendAxisValue(idx)}
                    >
                      再加一个值
                    </Button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom / advanced */}
      <div>
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-400"
        >
          <Settings2 size={12} />
          {showCustom ? '收起自定义' : '自定义其他参数变化'}
        </button>
        <AnimatePresence>
          {showCustom && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2"
            >
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-zinc-800 p-3">
                {fields.map((f) =>
                  usedFieldNames.has(f.key) ? null : (
                    <Tag
                      key={f.key}
                      className="!m-0 cursor-pointer !border-zinc-800 !bg-zinc-900 !text-zinc-300 hover:!border-brand-500"
                      onClick={() => addCustomAxis(f)}
                    >
                      + {f.label}
                    </Tag>
                  )
                )}
                {!usedFieldNames.has('_prompt') && (
                  <Tag
                    className="!m-0 cursor-pointer !border-zinc-800 !bg-zinc-900 !text-zinc-300 hover:!border-brand-500"
                    onClick={addCustomPromptAxis}
                  >
                    + 多个 Prompt
                  </Tag>
                )}
                {fields.length === usedFieldNames.size && usedFieldNames.has('_prompt') && (
                  <span className="text-xs text-zinc-500">已添加所有可变参数</span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Live preview of resulting sub-tasks */}
      {isBatch && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-500">
            实际会生成的 {total} 个结果 {total > 6 && <span className="text-zinc-600">(显示前 6 个)</span>}
          </div>
          <div className="space-y-1">
            {previewItems.map((item) => (
              <div
                key={item.idx}
                className="flex items-center gap-2 rounded-md bg-zinc-950/60 px-2.5 py-1.5 text-xs"
              >
                <span className="font-mono text-[10px] text-zinc-600">
                  #{(item.idx + 1).toString().padStart(2, '0')}
                </span>
                <span className="truncate text-zinc-300">{item.parts.join(' · ')}</span>
              </div>
            ))}
            {total > 6 && (
              <div className="px-2.5 py-1 text-xs text-zinc-600">…还有 {total - 6} 个</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
