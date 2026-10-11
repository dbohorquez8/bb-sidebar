import { matchStateLine } from "./state-line";
import { extractStepInvocation, mapStepToStage } from "./stage";
import type {
  AttentionPreset,
  ObservationEvent,
  StateLineMatch,
  ThreadEventRowLike,
  ThreadObservation,
} from "./types";

const BACKGROUND_ROW_TYPES = new Set([
  "item/delegation/progress",
  "item/delegation/completed",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
]);

function isBackgroundItemStart(row: ThreadEventRowLike): boolean {
  if (row.type !== "item/started") return false;
  const data = row.data as { item?: { type?: string } };
  return data.item?.type === "backgroundTask" || data.item?.type === "delegation";
}

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
  const events: ObservationEvent[] = [];
  let maxSeq: number | null = null;

  for (const row of rows) {
    maxSeq = maxSeq === null ? row.seq : Math.max(maxSeq, row.seq);

    if (row.type === "turn/started") {
      events.push({ kind: "turn-started", at: row.createdAt });
      continue;
    }

    if (row.type === "turn/completed") {
      const data = row.data as { status?: string };
      if (data.status === "completed") {
        events.push({ kind: "turn-ended", at: row.createdAt, finalReply: null });
      } else {
        events.push({ kind: "turn-failed", at: row.createdAt });
      }
      continue;
    }

    if (isBackgroundItemStart(row) || BACKGROUND_ROW_TYPES.has(row.type)) {
      events.push({ kind: "background-activity", at: row.createdAt });
      continue;
    }

    const step = extractStepInvocation(row);
    if (step !== null) {
      events.push({ kind: "step-invoked", at: row.createdAt, step });
      continue;
    }

    if (row.type === "system/interaction/lifecycle") {
      const data = row.data as { interaction?: { status?: string } };
      if (data.interaction?.status === "pending") {
        events.push({ kind: "interaction-raised", at: row.createdAt });
      } else {
        events.push({ kind: "interaction-resolved", at: row.createdAt });
      }
      continue;
    }
  }

  if (maxSeq !== null) events.push({ kind: "cursor", seq: maxSeq });
  return events;
}

export function finalReplyTurn(
  rows: readonly ThreadEventRowLike[],
): { seq: number; at: number } | null {
  let result: { seq: number; at: number } | null = null;
  for (const row of rows) {
    if (row.type === "turn/started") {
      result = null;
      continue;
    }
    if (row.type === "turn/completed") {
      const data = row.data as { status?: string };
      if (data.status === "completed") {
        result = { seq: row.seq, at: row.createdAt };
      }
    }
  }
  return result;
}

export function applyObservationEvent(
  previous: ThreadObservation | undefined,
  threadId: string,
  event: ObservationEvent,
  presets: readonly AttentionPreset[],
): ThreadObservation {
  const base: ThreadObservation = previous ?? {
    v: 2,
    threadId,
    cursorSeq: null,
    turnStartedAt: null,
    turnEndedAt: null,
    reply: null,
    steps: {},
    lastActivityAt: null,
    interactionAt: null,
    observedAt: 0,
  };

  switch (event.kind) {
    case "turn-started":
      return { ...base, reply: null, turnStartedAt: event.at };
    case "turn-ended": {
      const matches: Record<string, StateLineMatch> = {};
      for (const preset of presets) {
        if (preset.kind !== "state-markers") continue;
        const match = matchStateLine(event.finalReply, preset.rules);
        if (match) matches[preset.id] = match;
      }
      return { ...base, turnEndedAt: event.at, reply: { endedAt: event.at, matches } };
    }
    case "turn-failed":
      return { ...base, turnEndedAt: event.at, reply: null };
    case "step-invoked": {
      const steps = { ...base.steps };
      for (const preset of presets) {
        if (preset.kind !== "workflow") continue;
        const mapped = mapStepToStage(event.step, preset);
        if (mapped) steps[preset.id] = { stageId: mapped.stageId, at: event.at };
      }
      return { ...base, steps };
    }
    case "background-activity":
      return {
        ...base,
        lastActivityAt: base.lastActivityAt === null ? event.at : Math.max(base.lastActivityAt, event.at),
      };
    case "interaction-raised":
      return { ...base, interactionAt: event.at };
    case "interaction-resolved":
      return { ...base, interactionAt: null };
    case "cursor":
      return {
        ...base,
        cursorSeq: base.cursorSeq === null ? event.seq : Math.max(base.cursorSeq, event.seq),
      };
    default:
      return base;
  }
}

export function coldReadComplete(
  rowsNewestFirst: readonly ThreadEventRowLike[],
  presets: readonly AttentionPreset[],
): boolean {
  let hasTurnStarted = false;
  let hasBackgroundActivity = false;
  let hasMappedStep = false;

  for (const row of rowsNewestFirst) {
    if (row.type === "turn/started") hasTurnStarted = true;
    if (isBackgroundItemStart(row) || BACKGROUND_ROW_TYPES.has(row.type)) {
      hasBackgroundActivity = true;
    }
    const step = extractStepInvocation(row);
    if (
      step !== null &&
      presets.some(
        (preset) => preset.kind === "workflow" && preset.rules.some((rule) => rule.step === step),
      )
    ) {
      hasMappedStep = true;
    }
  }

  return hasTurnStarted && hasBackgroundActivity && hasMappedStep;
}

export function parseStoredObservation(json: unknown): ThreadObservation | null {
  if (json === null || typeof json !== "object") return null;
  const candidate = json as Partial<ThreadObservation>;
  if (candidate.v !== 2) return null;
  if (typeof candidate.threadId !== "string") return null;
  return candidate as ThreadObservation;
}
