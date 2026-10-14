import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isTurnInFlight } from "../lifecycle";
import type { BackgroundWork, BbWord, ObservedReply, ResolvedStatus, StateRuleKind, AttentionPreset } from "./types";

export interface AttentionInput {
  hasPendingInteraction: boolean;
  turnRunning: boolean;
  /** Error or failed send reported, minus a user acknowledgement (AC-09). */
  failureReported: boolean;
  unreadResult: boolean;
  background: BackgroundWork;
  /** From the enabled state-marker presets; null when none matched or none enabled. */
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

export function attentionInputFromThread(
  thread: PluginSidebarThread,
  context: {
    verdict: StateRuleKind | null;
    silent: boolean;
    onInactiveShelf: boolean;
    failureAcknowledged: boolean;
  },
): AttentionInput {
  const turnRunning =
    isTurnInFlight(thread.status) ||
    thread.indicator === "runtime" ||
    thread.indicator === "working-draft";

  const failureReported =
    (thread.indicator === "unread-error" ||
      thread.queuedWork === "failed" ||
      thread.indicator === "queued-failed") &&
    !context.failureAcknowledged;

  const unreadResult = thread.indicator === "unread-success";

  const background: BackgroundWork = {
    workers: thread.activity.backgroundAgents,
    commands: thread.activity.backgroundCommands,
    workflows: thread.activity.workflows,
  };

  let bbWord: BbWord | null = null;
  if (thread.indicator === "draft") {
    bbWord = "draft";
  } else if (thread.queuedWork === "waiting" || thread.indicator === "queued-waiting") {
    bbWord = "queued";
  } else if (thread.indicator === "plan-mode") {
    bbWord = "planning";
  } else if (thread.indicator === "goal") {
    bbWord = "goal";
  }

  return {
    hasPendingInteraction: thread.hasPendingInteraction,
    turnRunning,
    failureReported,
    unreadResult,
    background,
    verdict: context.verdict,
    silent: context.silent,
    onInactiveShelf: context.onInactiveShelf,
    bbWord,
  };
}

export function verdictFor(
  reply: ObservedReply | null,
  enabledPresets: readonly AttentionPreset[],
): StateRuleKind | null {
  if (!reply) return null;
  let best: { line: number; kind: StateRuleKind } | null = null;
  for (const preset of enabledPresets) {
    if (preset.kind !== "state-markers") continue;
    const match = reply.matches[preset.id];
    if (!match) continue;
    if (!best || match.line > best.line) {
      best = { line: match.line, kind: match.kind };
    }
  }
  return best ? best.kind : null;
}
