import { Input, InputNumber, Select, Switch, Form } from 'antd';
import { Dices } from 'lucide-react';
import type { Capability, ParamField } from '@bvp/shared';

export interface ParamPanelProps {
  capability: Capability;
  modelVariant: string;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

function isFieldVisible(field: ParamField, modelVariant: string): boolean {
  if (!field.dependsOn) return true;
  for (const dep of field.dependsOn) {
    if (dep.field !== 'modelVariant') continue;
    if (dep.op === 'eq' && dep.value !== modelVariant) return false;
    if (dep.op === 'neq' && dep.value === modelVariant) return false;
    if (dep.op === 'in' && Array.isArray(dep.value) && !(dep.value as unknown[]).includes(modelVariant))
      return false;
  }
  return true;
}

function filterEnumByModel(field: ParamField, modelVariant: string) {
  if (!field.enum) return [];
  return field.enum.filter((e) => !e.modelScope || e.modelScope.includes(modelVariant));
}

export default function ParamPanel({ capability, modelVariant, values, onChange }: ParamPanelProps) {
  function set(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-4">
      {capability.parameterSpec.map((field) => {
        if (!isFieldVisible(field, modelVariant)) return null;
        const key = field.key;
        const current = values[key];
        const help = field.help ?? field.warn;
        return (
          <Form.Item
            key={key}
            label={
              <div className="flex items-center gap-2">
                <span className="text-sm">{field.label}</span>
                {field.affectsCost && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                    影响计费
                  </span>
                )}
              </div>
            }
            extra={help && <span className="text-xs text-zinc-500">{help}</span>}
            className="!mb-0"
          >
            {field.type === 'enum' && (
              <Select
                value={current as string}
                onChange={(v) => set(key, v)}
                options={filterEnumByModel(field, modelVariant).map((opt) => ({
                  value: opt.value as string | number,
                  label: opt.label,
                }))}
                placeholder="请选择"
                size="middle"
              />
            )}
            {(field.type === 'int' || field.type === 'float') && (
              <div className="flex gap-2">
                <InputNumber
                  className="flex-1"
                  value={current as number}
                  min={field.range?.[0]}
                  max={field.range?.[1]}
                  step={field.step ?? (field.type === 'int' ? 1 : 0.1)}
                  precision={field.type === 'int' ? 0 : undefined}
                  onChange={(v) => set(key, v ?? undefined)}
                  placeholder={field.default !== undefined ? String(field.default) : '不设置'}
                />
                {field.key.endsWith('.seed') && (
                  <button
                    type="button"
                    className="rounded-md border border-zinc-800 px-3 text-zinc-400 hover:border-brand-500 hover:text-brand-400"
                    onClick={() => set(key, Math.floor(Math.random() * 2147483647))}
                    title="随机 seed"
                  >
                    <Dices size={16} />
                  </button>
                )}
              </div>
            )}
            {field.type === 'bool' && (
              <Switch checked={Boolean(current ?? field.default)} onChange={(v) => set(key, v)} />
            )}
            {(field.type === 'string' || field.type === 'size' || field.type === 'ratio') && (
              <Input
                value={current as string}
                onChange={(e) => set(key, e.target.value)}
                placeholder={field.default !== undefined ? String(field.default) : ''}
              />
            )}
            {field.type === 'text' && (
              <Input.TextArea
                rows={3}
                value={current as string}
                onChange={(e) => set(key, e.target.value)}
              />
            )}
          </Form.Item>
        );
      })}
    </div>
  );
}
