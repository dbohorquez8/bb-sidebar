import { evaluateRuleEvent, isWakeMessage, resetsLabel, ruleSkills, rulesDocumentVersion, type AttentionRulesDocument, type RuleOutcome } from "./rules";
import { extractStepInvocation } from "./stage";
import type {
  ObservationEvent,
  ObservedRules,
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

/** BB records /clear as a thread-level operation row (WS-70); other operations never reset anything. */
function isContextClear(row: ThreadEventRowLike): boolean {
  if (row.type !== "system/operation") return false;
  const data = row.data as { operation?: string; status?: string };
  return data.operation === "context_clear" && data.status === "completed";
}

/**
 * Who asked for a turn. Only `initiator=user` with no `senderThreadId` can be the Owner;
 * BB's own wake-ups are `system` and other threads' tells are `agent` with a sender (WS-142).
 * A CLI send from inside a thread is also recorded as the user, so the caller still checks
 * the text against the rules' wake-message patterns.
 */
function turnRequestedEvent(row: ThreadEventRowLike): ObservationEvent {
  const data = row.data as {
    initiator?: unknown;
    senderThreadId?: unknown;
    input?: readonly { type?: unknown; text?: unknown }[];
  };
  const byOwner = data.initiator === "user" && (data.senderThreadId === null || data.senderThreadId === undefined);
  const text = byOwner
    ? (data.input ?? []).flatMap((block) => (typeof block.text === "string" ? [block.text] : [])).join("\n").trim()
    : "";
  return { kind: "turn-requested", at: row.createdAt, byOwner, text };
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
  "system/operation",
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

    if (row.type === "client/turn/requested") events.push(turnRequestedEvent(row));

    const step = extractStepInvocation(row);
    if (step !== null) {
      events.push({ kind: "step-invoked", at: row.createdAt, step });
      continue;
    }

    if (isContextClear(row)) {
      events.push({ kind: "context-cleared", at: row.createdAt });
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

/** Rule outcome carried by an observation; the stamp is the active document's version. */
function foldRules(
  base: ThreadObservation,
  document: AttentionRulesDocument | null | undefined,
  event: ObservationEvent,
): ObservedRules {
  const version = rulesDocumentVersion(document);
  const held: ObservedRules = base.rules && base.rules.version === version ? base.rules : { version, status: null, label: null };
  const previous: RuleOutcome = { status: held.status, label: held.label };
  let outcome = previous;
  // Needs you is sticky (WS-142): once set it survives later agent turns and replies, even
  // one ending in Done, until the Owner's next message or a /clear.
  const sticky = previous.status === "needs-you";
  if (event.kind === "turn-requested") {
    if (event.byOwner && !isWakeMessage(document, event.text)) outcome = { ...previous, status: null };
  } else if (event.kind === "turn-started") outcome = { ...previous, status: sticky ? previous.status : null };
  else if (event.kind === "turn-failed") outcome = { ...previous, status: sticky ? previous.status : null };
  else if (event.kind === "context-cleared") outcome = { status: null, label: null };
  else if (event.kind === "turn-ended") {
    outcome = evaluateRuleEvent(document, { ...previous, status: null }, { kind: "reply", text: event.finalReply });
    if (sticky) outcome = { ...outcome, status: "needs-you" };
  } else if (event.kind === "step-invoked") {
    outcome = evaluateRuleEvent(document, previous, { kind: "skill", skill: event.step });
    if (sticky) outcome = { ...outcome, status: "needs-you" };
  }
  const labelAt = outcome.label === null ? undefined : outcome.label === previous.label ? held.labelAt : (event as { at?: number }).at;
  return { version, status: outcome.status, label: outcome.label, ...(labelAt !== undefined ? { labelAt } : {}) };
}

/**
 * Folds a child thread's label into its parent's: the newest label wins, and a
 * label set before the parent's last reset never counts. Returns the same
 * object when nothing changes.
 */
export function mergeChildLabel(parent: ThreadObservation, child: ThreadObservation | null | undefined): ThreadObservation {
  const incoming = child?.rules;
  if (!incoming?.label || incoming.labelAt === undefined || !parent.rules) return parent;
  if (incoming.version !== parent.rules.version) return parent;
  if (incoming.labelAt < (parent.labelResetAt ?? 0)) return parent;
  if (parent.rules.labelAt !== undefined && parent.rules.labelAt >= incoming.labelAt) return parent;
  return { ...parent, rules: { ...parent.rules, label: incoming.label, labelAt: incoming.labelAt } };
}

export function applyObservationEvent(
  previous: ThreadObservation | undefined,
  threadId: string,
  event: ObservationEvent,
  rules?: AttentionRulesDocument | null,
): ThreadObservation {
  const next = applyObservedEvent(previous, threadId, event, rules);
  return { ...next, rules: foldRules(next, rules, event) };
}

function applyObservedEvent(
  previous: ThreadObservation | undefined,
  threadId: string,
  event: ObservationEvent,
  rules: AttentionRulesDocument | null | undefined,
): ThreadObservation {
  const base: ThreadObservation = previous ?? {
    v: 2,
    threadId,
    cursorSeq: null,
    turnStartedAt: null,
    turnEndedAt: null,
    reply: null,
    lastActivityAt: null,
    interactionAt: null,
    observedAt: 0,
  };

  switch (event.kind) {
    case "turn-started":
      return { ...base, reply: null, turnStartedAt: event.at };
    case "turn-ended":
      return { ...base, turnEndedAt: event.at, reply: { endedAt: event.at } };
    case "turn-failed":
      return { ...base, turnEndedAt: event.at, reply: null };
    case "step-invoked": {
      if (!resetsLabel(rules, event.step)) return base;
      const { slices: _slices, ...rest } = base;
      return { ...rest, labelResetAt: event.at };
    }
    case "context-cleared": {
      const { slices: _slices, ...rest } = base;
      return { ...rest, reply: null, labelResetAt: event.at };
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

/** `<feature-slug>-slice-<NN>`: the worktree name a slice build worker gets. */
export function sliceNumberOf(name: string | null | undefined): { feature: string; slice: number } | null {
  if (!name) return null;
  const match = /^(.+)-slice-(\d+)$/.exec(name);
  return match ? { feature: match[1]!, slice: Number(match[2]) } : null;
}

/** Slices in a `slices.md`: every `## N.` heading, else the `Total slices: N` line. */
export function countSlicesInPlan(markdown: string): number | null {
  const headings = markdown.match(/^## \d+\./gm)?.length ?? 0;
  if (headings > 0) return headings;
  const total = /Total slices:\s*(\d+)/.exec(markdown);
  return total ? Number(total[1]) : null;
}

/**
 * Folds one slice worker into the orchestrator's progress. `done` only grows
 * (a set of slice numbers); the newest worker's feature wins. A worker last active before
 * the parent's last reset is ignored. Returns the same
 * object when nothing changes.
 */
export function mergeSliceProgress(
  parent: ThreadObservation,
  worker: { feature: string; slice: number; finished: boolean; at: number },
  planTotal: number | null,
): ThreadObservation {
  // A worker from before the parent's last workflow reset belongs to older work.
  const resetAt = parent.labelResetAt ?? 0;
  if (worker.at < resetAt) return parent;
  const current = parent.slices;
  const sameFeature = current?.feature === worker.feature;
  // An older feature's worker (re-scanned every sync) must not displace the newer feature's count.
  if (current && !sameFeature && worker.at <= current.at) return parent;
  const total = planTotal ?? (sameFeature ? current.total : null);
  if (total === null || total < 1) return parent;
  const kept = sameFeature ? current.done : [];
  const done = worker.finished && !kept.includes(worker.slice) ? [...kept, worker.slice].sort((a, b) => a - b) : kept;
  const at = sameFeature ? Math.max(current.at, worker.at) : worker.at;
  if (sameFeature && current.total === total && done === kept && current.at === at) return parent;
  return { ...parent, slices: { feature: worker.feature, total, done, at } };
}

export function coldReadComplete(
  rowsNewestFirst: readonly ThreadEventRowLike[],
  rules: AttentionRulesDocument | null | undefined,
): boolean {
  const skills = ruleSkills(rules);
  let hasTurnStarted = false;
  let hasBackgroundActivity = false;
  let hasMappedStep = skills.size === 0;

  for (const row of rowsNewestFirst) {
    if (row.type === "turn/started") hasTurnStarted = true;
    if (isBackgroundItemStart(row) || BACKGROUND_ROW_TYPES.has(row.type)) {
      hasBackgroundActivity = true;
    }
    const step = extractStepInvocation(row);
    if (step !== null && skills.has(step)) hasMappedStep = true;
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
