import type { AttentionInput } from "./status";
import type { ResolvedStatus, ThreadObservation } from "./types";

export function statusKey(status: ResolvedStatus): string {
  return status.kind === "bb-word" ? `bb-word:${status.word}` : status.kind;
}

export interface StatusSinceEntry {
  key: string;
  since: number;
}

export function historySince(
  status: ResolvedStatus,
  input: AttentionInput,
  observation: ThreadObservation | null,
): number | null {
  if (observation === null) return null;
  switch (status.kind) {
    case "needs-you":
      return input.hasPendingInteraction ? observation.interactionAt : (observation.reply?.endedAt ?? null);
    case "working":
      return input.turnRunning ? observation.turnStartedAt : (observation.reply?.endedAt ?? null);
    case "failed":
    case "background":
      return observation.turnEndedAt;
    case "done":
      return observation.reply?.endedAt ?? observation.turnEndedAt;
    default:
      return null;
  }
}

export function reconcileStatusSince(
  previous: ReadonlyMap<string, StatusSinceEntry>,
  current: ReadonlyMap<string, string>, // threadId → statusKey
  now: number, // Date.now(), not the minute-quantized clock
  historySinceOf: (threadId: string) => number | null,
): ReadonlyMap<string, StatusSinceEntry> {
  let changed = current.size !== previous.size;
  const next = new Map<string, StatusSinceEntry>();
  for (const [threadId, key] of current) {
    const historyTime = historySinceOf(threadId);
    const previousEntry = previous.get(threadId);
    let entry: StatusSinceEntry;
    if (historyTime !== null) {
      entry = { key, since: historyTime };
    } else if (previousEntry && previousEntry.key === key) {
      entry = previousEntry;
    } else {
      entry = { key, since: now };
    }
    if (!previousEntry || previousEntry.key !== entry.key || previousEntry.since !== entry.since) {
      changed = true;
    }
    next.set(threadId, entry);
  }
  return changed ? next : previous;
}

export function reconcileFailedAck(
  previous: ReadonlySet<string>,
  failing: ReadonlySet<string>, // threads whose failure is reported (before ack)
  activeThreadId: string | null,
  previousActiveThreadId: string | null,
): ReadonlySet<string> {
  const next = new Set<string>();
  for (const id of previous) {
    if (failing.has(id)) next.add(id);
  }
  if (
    activeThreadId !== null &&
    activeThreadId !== previousActiveThreadId &&
    failing.has(activeThreadId)
  ) {
    next.add(activeThreadId);
  }
  return next;
}
