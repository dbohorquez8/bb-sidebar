// Host adapter: turns a BB sidebar thread into the neutral status input. It lives
// outside src/attention/ because it reads the SDK thread type and sidebar modules.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { AttentionInput, BackgroundWork, BbWord, StateRuleKind } from "./attention";
import { childFailureReported } from "./child-failure";
import { isTurnInFlight } from "./lifecycle";

export function attentionInputFromThread(
  thread: PluginSidebarThread,
  context: {
    verdict: StateRuleKind | null;
    silent: boolean;
    onInactiveShelf: boolean;
    failureAcknowledged: boolean;
    /** Child-failure inputs (WS-51); omitted means no status-derived failure. */
    parentOpen?: boolean;
    now?: number;
  },
): AttentionInput {
  const turnRunning =
    isTurnInFlight(thread.status) ||
    thread.indicator === "runtime" ||
    thread.indicator === "working-draft";

  const failureReported =
    ((thread.indicator === "unread-error" ||
      thread.queuedWork === "failed" ||
      thread.indicator === "queued-failed") &&
      !context.failureAcknowledged) ||
    (context.now !== undefined &&
      childFailureReported(thread, {
        parentOpen: context.parentOpen ?? false,
        acknowledged: context.failureAcknowledged,
        now: context.now,
      }));

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
