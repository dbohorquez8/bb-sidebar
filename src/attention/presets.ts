import type { AttentionPreset } from "./types";

// Boundary rule (upstreamability): this is the only shipped source file that
// may contain the literals NEEDS YOU, 🔴, 🟢, 🟡, ⚪, ddd:, coding-loop, DDD,
// or Coding loop. Every other attention function receives presets or rules as
// an argument.

const DDD_STAGES = [
  { id: "scaffold", label: "Scaffold" },
  { id: "explore", label: "Explore" },
  { id: "propose", label: "Propose" },
  { id: "spec", label: "Spec" },
  { id: "validation-plan", label: "Validation plan" },
  { id: "plan", label: "Plan" },
  { id: "slice", label: "Slice" },
  { id: "build", label: "Build" },
  { id: "verify", label: "Verify" },
  { id: "ship", label: "Ship" },
] as const;

export const ATTENTION_PRESETS: readonly AttentionPreset[] = [
  {
    id: "adhd-ish-state-markers",
    label: "adhd-ish state markers",
    kind: "state-markers",
    rules: [
      { marker: "🔴 NEEDS YOU", kind: "needs-you" },
      { marker: "🟢", kind: "background" },
      { marker: "🟡", kind: "working" },
      { marker: "⚪", kind: "done" },
    ],
  },
  {
    id: "ddd-workflow",
    label: "DDD workflow",
    kind: "workflow",
    workflow: { id: "ddd", label: "DDD", stages: DDD_STAGES },
    rules: [
      { step: "ddd:scaffold", stageId: "scaffold" },
      { step: "ddd:explore", stageId: "explore" },
      { step: "ddd:propose", stageId: "propose" },
      { step: "ddd:spec", stageId: "spec" },
      { step: "ddd:validation-plan", stageId: "validation-plan" },
      { step: "ddd:plan", stageId: "plan" },
      { step: "ddd:slice", stageId: "slice" },
      { step: "ddd:dispatch", stageId: "build" },
      { step: "ddd:verify", stageId: "verify" },
      { step: "ddd:push", stageId: "ship" },
    ],
  },
  {
    id: "coding-loop-workflow",
    label: "coding-loop workflow",
    kind: "workflow",
    workflow: { id: "coding-loop", label: "Coding loop", stages: [{ id: "loop", label: "Loop" }] },
    rules: [{ step: "coding-loop", stageId: "loop" }],
  },
];

export function presetById(id: string): AttentionPreset | undefined {
  return ATTENTION_PRESETS.find((preset) => preset.id === id);
}
