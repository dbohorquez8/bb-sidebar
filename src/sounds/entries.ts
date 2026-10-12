// Entry detection and the baseline (spec Terms "Baseline", "Entry"). Pure;
// time is a parameter.

export type ChimeStatus = "needs-you" | "done";
/** attention's statusKey(): "needs-you", "done", "check", "failed", "working", "background", "idle", "bb-word:<word>". */
export type StatusKey = string;
export const NO_STATUS = "none";

/** "needs-you" -> "needs-you"; "done" -> "done"; every other key (and NO_STATUS) -> null. */
export function chimeStatusOf(key: StatusKey): ChimeStatus | null {
  return key === "needs-you" || key === "done" ? key : null;
}

export interface ThreadSnapshot {
  /** Status per non-archived thread whose status inputs have loaded (see AttentionModel.chimeStatuses). */
  statuses: ReadonlyMap<string, StatusKey>;
  /** BB's createdAt per thread in the sidebar's thread list, archived ones included. */
  createdAt: ReadonlyMap<string, number>;
  /** Threads BB currently reports as archived. */
  archived: ReadonlySet<string>;
}

export interface EntryTracker {
  /** When listening started (the baseline moment). */
  listeningSince: number;
  /** The last status the sidebar holds per tracked thread. */
  held: ReadonlyMap<string, StatusKey>;
  /** Threads seen archived since listening started. */
  returning: ReadonlySet<string>;
}

export interface ChimeEntry {
  threadId: string;
  status: ChimeStatus;
  /** When this window learned of the change (the processing time of the update). */
  learnedAt: number;
}

/** Baseline: every status in the snapshot is held; nothing is an entry (AC-14). */
export function startListening(snapshot: ThreadSnapshot, at: number): EntryTracker {
  return {
    listeningSince: at,
    held: new Map(snapshot.statuses),
    returning: new Set(),
  };
}

/**
 * For each thread in snapshot.statuses:
 *  - held status exists: entry iff chimeStatusOf(next) !== null and
 *    chimeStatusOf(next) !== chimeStatusOf(held). So needs-you -> done and
 *    done -> needs-you are entries; needs-you -> needs-you (any source) is not
 *    (AC-50); a non-chime next status never is (AC-05).
 *  - not held, and (id is in `returning` or createdAt <= listeningSince):
 *    a returning or late-reported old thread; its status becomes held, no entry
 *    (unarchive rule; see Spec / Reality Mismatch 2).
 *  - not held, createdAt > listeningSince (or createdAt unknown and not
 *    returning): previous is NO_STATUS; entry iff next is a chime status.
 *  - exception: held "failed" -> next "done" is never an entry. Between two
 *    snapshots that change comes only from the failure acknowledgement (the
 *    owner viewing the failed thread, `reconcileFailedAck`), because a new turn
 *    passes through "working" first (spec Terms "Entry"). The status becomes held.
 * Threads held but absent from snapshot.statuses are dropped from `held`;
 * those in snapshot.archived are added to `returning`. Entries are returned
 * in snapshot iteration order, all with learnedAt = at.
 */
export function detectEntries(
  tracker: EntryTracker,
  snapshot: ThreadSnapshot,
  at: number,
): { tracker: EntryTracker; entries: ChimeEntry[] } {
  const entries: ChimeEntry[] = [];
  const held = new Map<string, StatusKey>();
  const returning = new Set(tracker.returning);

  for (const [threadId, next] of snapshot.statuses) {
    const nextChime = chimeStatusOf(next);
    const previous = tracker.held.get(threadId);
    held.set(threadId, next);
    if (previous !== undefined) {
      if (previous === "failed" && next === "done") continue;
      if (nextChime !== null && nextChime !== chimeStatusOf(previous)) {
        entries.push({ threadId, status: nextChime, learnedAt: at });
      }
      continue;
    }
    const createdAt = snapshot.createdAt.get(threadId);
    const oldThread =
      returning.has(threadId) || (createdAt !== undefined && createdAt <= tracker.listeningSince);
    if (oldThread) continue;
    if (nextChime !== null) entries.push({ threadId, status: nextChime, learnedAt: at });
  }

  for (const threadId of snapshot.archived) returning.add(threadId);
  for (const threadId of tracker.held.keys()) {
    if (!snapshot.statuses.has(threadId) && snapshot.archived.has(threadId)) returning.add(threadId);
  }

  return { tracker: { listeningSince: tracker.listeningSince, held, returning }, entries };
}
