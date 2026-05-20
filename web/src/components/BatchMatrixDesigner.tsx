import { useMemo } from 'react';
import { Input, Select, Tag, Tooltip, Button } from 'antd';
import { Plus, X, Layers } from 'lucide-react';
import type { BatchAxis, BatchMatrix, Capability, ParamField } from '@bvp/shared';

interface Props {
  capability: Capability;
  modelVariant: string;
  value: BatchMatrix;
  onChange: (next: BatchMatrix) => void;
  basePrompt?: string;
}

function sweepableFields(cap: Capability): ParamField[] {
  return cap.parameterSpec.filter((f) => f.sweepable.allowed);
}

export default function BatchMatrixDesigner({ capability, modelVariant, value, onChange, basePrompt }: Props) {
  const fields = sweepableFields(capability);
  const usedFieldNames = new Set(value.axes.map((a) => a.name));

  const total = useMemo(() => {
    if (value.axes.length === 0) return 1;
    return value.axes.reduce((acc, ax) => acc * Math.max(1, ax.values.length), 1);
  }, [value.axes]);

  function addAxis(field: ParamField) {
    const optionList =
      field.enum?.filter((e) => !e.modelScope || e.modelScope.includes(modelVariant)) ?? [];
    const initialValues =
      optionList.length >= 2
        ? optionList.slice(0, 2).map((o) => ({
            label: String(o.label),
            paramOverrides: { [field.key]: o.value },
          }))
        : [
            {
              label: `${field.label} A`,
              paramOverrides: field.range ? { [field.key]: field.range[0] } : {},
            },
            {
              label: `${field.label} B`,
              paramOverrides: field.range ? { [field.key]: field.range[1] } : {},
            },
          ];
    const newAxis: BatchAxis = { name: field.key, values: initialValues };
    onChange({ ...value, axes: [...value.axes, newAxis] });
  }

  function addPromptAxis() {
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

  function updateAxisValues(idx: number, next: BatchAxis['values']) {
    onChange({
      ...value,
      axes: value.axes.map((a, i) => (i === idx ? { ...a, values: next } : a)),
    });
  }

  function appendAxisValue(idx: number) {
    const axis = value.axes[idx];
    const field = fields.find((f) => f.key === axis.name);
    const next: BatchAxis['values'][number] = {
      label: `${axis.name} ${axis.values.length + 1}`,
      paramOverrides:
        field && field.range ? { [field.key]: field.range[0] } : { [axis.name]: '' },
    };
    if (axis.name === '_prompt') {
      delete next.paramOverrides;
      next.promptOverride = '';
    }
    updateAxisValues(idx, [...axis.values, next]);
  }

  function removeAxisValue(axisIdx: number, valueIdx: number) {
    const axis = value.axes[axisIdx];
    updateAxisValues(axisIdx, axis.values.filter((_, i) => i !== valueIdx));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">添加扫描轴：</span>
        {fields.map((f) =>
          usedFieldNames.has(f.key) ? null : (
            <Tag
              key={f.key}
              className="cursor-pointer !border-zinc-800 !bg-zinc-900 !text-zinc-300 hover:!border-brand-500"
              onClick={() => addAxis(f)}
            >
              + {f.label}
            </Tag>
          )
        )}
        {!usedFieldNames.has('_prompt') && (
          <Tag
            className="cursor-pointer !border-zinc-800 !bg-zinc-900 !text-zinc-300 hover:!border-brand-500"
            onClick={addPromptAxis}
          >
            + 多个 Prompt
          </Tag>
        )}
      </div>

      {value.axes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
          未添加扫描轴 — 将提交 1 个子任务
        </div>
      ) : (
        <div className="space-y-3">
          {value.axes.map((axis, idx) => {
            const field = fields.find((f) => f.key === axis.name);
            const isPrompt = axis.name === '_prompt';
            return (
              <div key={`${axis.name}-${idx}`} className="surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers size={14} className="text-brand-400" />
                    <span className="text-sm font-medium">
                      {isPrompt ? '多个 Prompt' : field?.label ?? axis.name}
                    </span>
                    <span className="text-xs text-zinc-500">{axis.values.length} 个值</span>
                  </div>
                  <Button type="text" size="small" onClick={() => removeAxis(idx)} icon={<X size={14} />} />
                </div>
                <div className="space-y-2">
                  {axis.values.map((v, vIdx) => (
                    <div key={vIdx} className="flex items-center gap-2">
                      <Input
                        size="small"
                        className="!w-28"
                        value={v.label}
                        onChange={(e) => {
                          const next = [...axis.values];
                          next[vIdx] = { ...v, label: e.target.value };
                          updateAxisValues(idx, next);
                        }}
                        placeholder="标签"
                      />
                      <div className="flex-1">
                        {isPrompt ? (
                          <Input.TextArea
                            rows={2}
                            value={v.promptOverride}
                            onChange={(e) => {
                              const next = [...axis.values];
                              next[vIdx] = { ...v, promptOverride: e.target.value };
                              updateAxisValues(idx, next);
                            }}
                          />
                        ) : field?.enum ? (
                          <Select
                            size="small"
                            className="w-full"
                            value={v.paramOverrides?.[field.key] as string}
                            onChange={(newVal) => {
                              const next = [...axis.values];
                              next[vIdx] = {
                                ...v,
                                paramOverrides: { ...v.paramOverrides, [field.key]: newVal },
                              };
                              updateAxisValues(idx, next);
                            }}
                            options={field.enum
                              .filter((e) => !e.modelScope || e.modelScope.includes(modelVariant))
                              .map((e) => ({ value: e.value as string | number, label: e.label }))}
                          />
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
                    添加值
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">将生成</span>
          <Tooltip title="所有扫描轴的笛卡尔积">
            <span className="font-mono text-lg text-brand-300">{total}</span>
          </Tooltip>
          <span className="text-sm text-zinc-400">个子任务</span>
        </div>
        {total > capability.batch.platformMaxFanout && (
          <div className="mt-1 text-xs text-rose-400">
            超过平台上限 {capability.batch.platformMaxFanout}，请减少扫描轴
          </div>
        )}
      </div>
    </div>
  );
}
