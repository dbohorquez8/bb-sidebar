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
  throw new Error("not implemented");
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
  throw new Error("not implemented");
}

export function verdictFor(
  reply: ObservedReply | null,
  enabledPresets: readonly AttentionPreset[],
): StateRuleKind | null {
  throw new Error("not implemented");
}
