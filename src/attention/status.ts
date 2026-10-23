import type { BackgroundWork, BbWord, ObservedRules, ResolvedStatus, StateRuleKind } from "./types";
import { statusKey } from "./since";

export interface AttentionInput {
  hasPendingInteraction: boolean;
  turnRunning: boolean;
  /** Error or failed send reported, minus a user acknowledgement (AC-09). */
  failureReported: boolean;
  unreadResult: boolean;
  background: BackgroundWork;
  /** From the active rules; null when none matched. */
  verdict: StateRuleKind | null;
  silent: boolean; // isSilentPastThreshold(silenceOrigin(...), now, threshold)
  onInactiveShelf: boolean; // today's isInactiveThread(...) result
  bbWord: BbWord | null;
}

export function resolveAttentionStatus(input: AttentionInput): ResolvedStatus {
  const backgroundCount =
    input.background.workers + input.background.commands + input.background.workflows;

  if (input.hasPendingInteraction || input.verdict === "needs-you") return { kind: "needs-you" };
  if (!input.turnRunning && input.silent && (backgroundCount > 0 || input.verdict === "working")) {
    return { kind: "check" };
  }
  if (input.failureReported && !input.turnRunning) return { kind: "failed" };
  if (input.turnRunning) return { kind: "working" };
  if (input.verdict === "working") return { kind: "background" };
  if (backgroundCount > 0) return { kind: "background" };
  // Done marks a result waiting for the owner: once it has been read, the
  // card is Idle, whatever the final reply's state line said (AC-52).
  if (input.unreadResult) return { kind: "done" };
  if (input.bbWord !== null) return { kind: "bb-word", word: input.bbWord };
  return { kind: "idle" };
}

/** The silent chime key for a Done card whose turn did not hand the next turn to the owner. */
export const QUIET_DONE_KEY = "done-quiet";

/**
 * The status key the chime reads. A Done card chimes only when the final
 * reply's state line said done and no child thread was running while it was
 * Done: an unmarked or background reply, or a parent waiting on its children
 * (which wake it with a new turn), shows Done but is not the owner's turn yet.
 */
export function chimeStatusKey(
  status: ResolvedStatus,
  verdict: StateRuleKind | null,
  heldByChild: boolean,
): string {
  if (status.kind === "done" && (verdict !== "done" || heldByChild)) return QUIET_DONE_KEY;
  return statusKey(status);
}

/**
 * The rule-driven state of a thread, or null. Only an outcome stamped with the
 * active document's version counts: a record made under other rules (or with no
 * document active) is withheld until it is rebuilt, so the card falls back to
 * BB's own state.
 */
export function verdictFor(
  rules: ObservedRules | undefined,
  activeVersion: string | null,
): StateRuleKind | null {
  if (!rules || activeVersion === null || rules.version !== activeVersion) return null;
  return rules.status;
}

const RUNNING_KINDS: ReadonlySet<string> = new Set(["working", "background", "check"]);

/**
 * An idle parent with a running child (one that resolves to working,
 * background or check) is waiting on it, so it shows the Waiting status
 * (WS-124). A Done parent stays Done (the chime holds it quiet while the child
 * runs); it is repeated so a grandparent follows its parent.
 *
 * A child with `markerOnly` set looks running only from its last reply's
 * marker: BB reports it idle with no live background work, past the silence
 * threshold. It does not hold its parent in Waiting (WS-140); the marker may
 * name the wrong word and nothing else would ever expire it.
 */
export function statusesWithWaitingParents(
  threads: ReadonlyArray<{ id: string; parentId: string | null; status: ResolvedStatus; markerOnly?: boolean }>,
): Map<string, ResolvedStatus> {
  const statusOf = new Map(threads.map((t) => [t.id, t.status]));
  for (let changed = true; changed; ) {
    changed = false;
    const waiting = new Set<string>();
    for (const { id, parentId, markerOnly } of threads) {
      if (parentId !== null && !markerOnly && RUNNING_KINDS.has(statusOf.get(id)?.kind ?? "")) waiting.add(parentId);
    }
    for (const [id, status] of statusOf) {
      if (status.kind === "idle" && waiting.has(id)) {
        statusOf.set(id, { kind: "background" });
        changed = true;
      }
    }
  }
  return statusOf;
}
