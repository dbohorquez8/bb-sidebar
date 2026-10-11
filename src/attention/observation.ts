import type { AttentionPreset, ObservationEvent, ThreadEventRowLike, ThreadObservation } from "./types";

// One sequence space (plan Auditor Finding 1): the observer reads BB's event
// history only through bb.sdk.threads.events.list with
// types: HISTORY_EVENT_TYPES, and cursorSeq is the highest seq among rows
// those filtered reads returned. See plan.md § Observation record.
export const HISTORY_EVENT_TYPES = [
  "turn/started",
  "turn/completed",
  "item/started",
  "client/turn/requested",
  "system/interaction/lifecycle",
  "item/delegation/progress",
  "item/delegation/completed",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
] as const;

export const HISTORY_PAGE_SIZE = 100; // BB refuses a larger limit (observed 2026-10-11)
export const COLD_READ_MAX_ROWS = 2000; // backward-read cap for a thread with no record

export function rowsToObservationEvents(
  rows: readonly ThreadEventRowLike[], // ascending seq, one filtered batch
): ObservationEvent[] {
  throw new Error("not implemented");
}

export function finalReplyTurn(
  rows: readonly ThreadEventRowLike[],
): { seq: number; at: number } | null {
  throw new Error("not implemented");
}

export function applyObservationEvent(
  previous: ThreadObservation | undefined,
  threadId: string,
  event: ObservationEvent,
  presets: readonly AttentionPreset[],
): ThreadObservation {
  throw new Error("not implemented");
}

export function coldReadComplete(
  rowsNewestFirst: readonly ThreadEventRowLike[],
  presets: readonly AttentionPreset[],
): boolean {
  throw new Error("not implemented");
}

export function parseStoredObservation(json: unknown): ThreadObservation | null {
  throw new Error("not implemented");
}
