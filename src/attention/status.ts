import type { BackgroundWork, BbWord, ObservedRules, ResolvedStatus, StateRuleKind } from "./types";

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
