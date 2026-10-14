import type { AttentionPreset, ObservedStep, SliceProgress, StageView, ThreadEventRowLike } from "./types";

interface ToolCallStartedData {
  item?: { type?: string; tool?: string; arguments?: { skill?: unknown } };
}

interface TurnRequestedMention {
  resource?: { kind?: string; source?: string; name?: string };
}

interface TurnRequestedInputBlock {
  mentions?: readonly TurnRequestedMention[];
}

interface TurnRequestedData {
  input?: readonly TurnRequestedInputBlock[];
}

export function extractStepInvocation(row: ThreadEventRowLike): string | null {
  if (row.type === "item/started") {
    const data = row.data as ToolCallStartedData;
    if (data.item?.type === "toolCall" && data.item.tool === "Skill") {
      const skill = data.item.arguments?.skill;
      if (typeof skill === "string" && skill.length > 0) {
        return skill.startsWith("/") ? skill.slice(1) : skill;
      }
    }
    return null;
  }

  if (row.type === "client/turn/requested") {
    const data = row.data as TurnRequestedData;
    let lastName: string | null = null;
    for (const block of data.input ?? []) {
      for (const mention of block.mentions ?? []) {
        const resource = mention.resource;
        if (
          resource?.kind === "command" &&
          resource.source === "skill" &&
          typeof resource.name === "string"
        ) {
          lastName = resource.name;
        }
      }
    }
    return lastName;
  }

  return null;
}

export function mapStepToStage(
  step: string,
  preset: Extract<AttentionPreset, { kind: "workflow" }>,
): { stageId: string; position: number; total: number } | null {
  const rule = preset.rules.find((candidate) => candidate.step === step);
  if (!rule) return null;
  const position = preset.workflow.stages.findIndex((stage) => stage.id === rule.stageId);
  if (position === -1) return null;
  return { stageId: rule.stageId, position: position + 1, total: preset.workflow.stages.length };
}

export function currentStage(
  steps: Readonly<Record<string, ObservedStep>>,
  enabledPresets: readonly AttentionPreset[],
  turnStartedAt: number | null = null,
  slices?: SliceProgress,
): StageView | null {
  let best: { preset: Extract<AttentionPreset, { kind: "workflow" }>; observed: ObservedStep } | null = null;
  for (const preset of enabledPresets) {
    if (preset.kind !== "workflow") continue;
    const observed = steps[preset.id];
    if (!observed) continue;
    if (!best || observed.at > best.observed.at) {
      best = { preset, observed };
    }
  }
  if (!best) return null;

  const position = best.preset.workflow.stages.findIndex((stage) => stage.id === best.observed.stageId);
  if (position === -1) return null;
  const stage = best.preset.workflow.stages[position];
  const total = best.preset.workflow.stages.length;
  // The last stage of a multi-stage workflow ends it: it shows only during the
  // turn that ran it. A later turn is work outside the workflow, so it gets the
  // plain status rather than a stale "Shipping".
  const finalStage = total > 1 && position === total - 1;
  if (finalStage && turnStartedAt !== null && turnStartedAt > best.observed.at) return null;
  return {
    presetId: best.preset.id,
    workflowLabel: best.preset.workflow.label,
    stageLabel: stage.label,
    position: position + 1,
    total,
    showMarks: total > 1,
    ...(stage.progress === "slices" && slices && slices.total >= 1
      ? { sliceProgress: { done: Math.min(slices.done.length, slices.total), total: slices.total } }
      : {}),
  };
}

/** The stage name as shown on the card: "Building", or "Building 2/5" with slice progress. */
export function stageText(stage: StageView): string {
  return stage.sliceProgress
    ? `${stage.stageLabel} ${stage.sliceProgress.done}/${stage.sliceProgress.total}`
    : stage.stageLabel;
}
