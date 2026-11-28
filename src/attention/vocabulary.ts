// WS-268 LC-3: the locked status vocabulary per effective kind. Pure.

import type { ThreadKind } from "./status-file";

export type EffectiveKind = "orchestrator" | "implementer" | "group-child" | "worker" | "session";

const IMPLEMENTER_PHASES = [
  "Exploring",
  "Proposing",
  "Speccing",
  "Validating",
  "Planning",
  "Slicing",
  "Building",
  "Verifying",
  "Gates queued",
  "Gates",
  "Reviewing",
  "Landing",
  "CI queued",
  "CI",
  "Fixing",
] as const;

const TOP_STATES = [
  "Waiting",
  "Working",
  "Needs you",
  "Failed",
  "Done",
  "Stopped",
  "Wrapped",
  "Finalized",
  "Handing over",
  "Handed over",
] as const;

export const PHASE_WORDS: Readonly<Record<EffectiveKind, readonly string[]>> = {
  orchestrator: ["Proposing", "Running", "Landing", "Gates queued", "Gates", "CI queued", "CI"],
  implementer: IMPLEMENTER_PHASES,
  "group-child": IMPLEMENTER_PHASES,
  worker: [],
  session: [],
};

export const STATE_WORDS: Readonly<Record<EffectiveKind, readonly string[]>> = {
  orchestrator: TOP_STATES,
  implementer: TOP_STATES,
  "group-child": [
    "Waiting",
    "Working",
    "Asking",
    "Verified",
    "Failed",
    "Landed",
    "Done",
    "Stopped",
    "Wrapped",
    "Finalized",
    "Handing over",
    "Handed over",
  ],
  worker: ["Working", "Asking", "Failed", "Done"],
  session: TOP_STATES,
};

export const END_WORDS = ["Finalized", "Stopped", "Wrapped", "Handed over", "Landed"] as const; // plus "Done" on any child

export function effectiveKind(
  own: ThreadKind | null,
  parent: { isChild: boolean; parentKind: ThreadKind | null },
): EffectiveKind | null {
  if (!parent.isChild) return own;
  if (own === null) return parent.parentKind === "orchestrator" ? "group-child" : "worker";
  if (own === "implementer") return "group-child";
  return own;
}
