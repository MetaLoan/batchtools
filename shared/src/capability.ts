export type CapabilityId =
  | 'qwen.t2i'
  | 'qwen.image_edit'
  | 'wan2.7.t2v'
  | 'wan2.6.i2v'
  | 'wan2.7.i2v'
  | 'wan2.6.r2v'
  | 'wan2.7.r2v'
  | 'wan2.7.video_edit';

export type CapabilityCategory = 't2i' | 'i2i' | 't2v' | 'i2v' | 'r2v' | 'v2v';

export type MediaKind =
  | 'source_image'
  | 'source_video'
  | 'first_frame'
  | 'last_frame'
  | 'first_clip'
  | 'reference_image'
  | 'reference_video'
  | 'reference_voice'
  | 'driving_audio';

export interface MediaInput {
  kind: MediaKind;
  url: string;
  localId?: string;
  boundTo?: string;
  meta?: { width?: number; height?: number; durationSec?: number; mime?: string; bytes?: number };
}

export interface ModelVariant {
  value: string;
  label: string;
  default?: boolean;
  description?: string;
}

export type ParamFieldType =
  | 'enum'
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'text'
  | 'size'
  | 'ratio';

export interface ParamFieldEnumOption {
  value: string | number | boolean;
  label: string;
  modelScope?: string[];
}

export interface ParamFieldDependency {
  field: string;
  op: 'eq' | 'in' | 'neq' | 'truthy';
  value?: unknown;
}

export interface ParamFieldSweepable {
  allowed: boolean;
  strategies?: ('list' | 'linearRange' | 'randomSeeds')[];
  costMultiplier?: 'linear' | 'quadratic';
}

export interface ParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  required?: boolean;
  default?: unknown;
  enum?: ParamFieldEnumOption[];
  range?: [number, number];
  step?: number;
  affectsCost?: boolean;
  dependsOn?: ParamFieldDependency[];
  sweepable: ParamFieldSweepable;
  help?: string;
  warn?: string;
}

export interface MediaSlot {
  kind: MediaKind;
  required: boolean;
  min: number;
  max: number;
  accept: ('image' | 'video' | 'audio')[];
  combinationGroup?: string;
  label?: string;
  hint?: string;
}

export type MediaMode = 'none' | 'single_image' | 'unified_media' | 'reference_urls';

export interface MediaSpec {
  mode: MediaMode;
  slots: MediaSlot[];
}

export interface PromptSpec {
  required: boolean;
  maxChars: number;
  supportsNegative: boolean;
  referenceSyntax?: 'character_n' | 'image_n_video_n_zh' | 'image_n_video_n_en';
  syntaxHelp?: string;
}

export interface Capability {
  id: CapabilityId;
  displayName: string;
  shortName: string;
  category: CapabilityCategory;
  providerName: 'dashscope';
  sync: boolean;
  models: ModelVariant[];
  promptSpec: PromptSpec;
  mediaSpec: MediaSpec;
  parameterSpec: ParamField[];
  batch: { nativeMax: number; platformMaxFanout: number };
  pollIntervalSec: { initial: number; max: number };
  docPath: string;
  description?: string;
}
