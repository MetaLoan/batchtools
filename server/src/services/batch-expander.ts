import type { BatchMatrix, MediaInput } from '@bvp/shared';

export interface SubJobDraft {
  indexInJob: number;
  axes: Record<string, unknown>;
  prompt?: string;
  negativePrompt?: string;
  media: MediaInput[];
  parameters: Record<string, unknown>;
  modelVariant: string;
}

export interface ExpandInput {
  basePrompt?: string;
  baseNegativePrompt?: string;
  baseMedia: MediaInput[];
  baseParameters: Record<string, unknown>;
  modelVariant: string;
  batchMatrix: BatchMatrix;
  maxFanout: number;
}

function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((prefix) => arr.map((v) => [...prefix, v])),
    [[]]
  );
}

export function expandMatrix(input: ExpandInput): SubJobDraft[] {
  const { batchMatrix } = input;
  const axes = batchMatrix.axes ?? [];

  // Treat empty matrix as 1 sub-job using base values.
  const valueGrids = axes.length === 0 ? [[]] : cartesian(axes.map((a) => a.values));

  if (valueGrids.length > input.maxFanout) {
    throw new Error(
      `Batch fanout ${valueGrids.length} exceeds platform limit ${input.maxFanout}`
    );
  }

  return valueGrids.map((coord, idx) => {
    let prompt = input.basePrompt;
    let negativePrompt = input.baseNegativePrompt;
    let media: MediaInput[] = [...input.baseMedia];
    const params: Record<string, unknown> = { ...input.baseParameters };
    let modelVariant = input.modelVariant;
    const axesDict: Record<string, unknown> = {};

    coord.forEach((val, i) => {
      const ax = axes[i];
      axesDict[ax.name] = val.label;
      if (val.paramOverrides) {
        for (const [k, v] of Object.entries(val.paramOverrides)) {
          if (k === 'modelVariant') {
            modelVariant = v as string;
          } else {
            params[k] = v;
          }
        }
      }
      if (val.promptOverride !== undefined) prompt = val.promptOverride;
      if (val.negativePromptOverride !== undefined) negativePrompt = val.negativePromptOverride;
      if (val.mediaOverride) media = val.mediaOverride;
    });

    const override = batchMatrix.overrides?.[idx];
    if (override?.paramOverrides) {
      for (const [k, v] of Object.entries(override.paramOverrides)) {
        if (k === 'modelVariant') modelVariant = v as string;
        else params[k] = v;
      }
    }
    if (override?.promptOverride !== undefined) prompt = override.promptOverride;
    if (override?.negativePromptOverride !== undefined) negativePrompt = override.negativePromptOverride;

    return {
      indexInJob: idx,
      axes: axesDict,
      prompt,
      negativePrompt,
      media,
      parameters: params,
      modelVariant,
    };
  });
}
