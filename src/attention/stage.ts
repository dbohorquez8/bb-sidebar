import type { AttentionPreset, ObservedStep, StageView, ThreadEventRowLike } from "./types";

export function extractStepInvocation(row: ThreadEventRowLike): string | null {
  throw new Error("not implemented");
}

export function mapStepToStage(
  step: string,
  preset: Extract<AttentionPreset, { kind: "workflow" }>,
): { stageId: string; position: number; total: number } | null {
  throw new Error("not implemented");
}

export function currentStage(
  steps: Readonly<Record<string, ObservedStep>>,
  enabledPresets: readonly AttentionPreset[],
): StageView | null {
  throw new Error("not implemented");
}
