// WS-268 LC-5: BB's server thread row → the live facts a card reads. Pure.

import { isTurnInFlight } from "../lifecycle";
import type { LiveFacts } from "./card";

/** The fields read from `bb.sdk.threads.list` rows (the SDK server DTO). */
export interface ServerThreadRow {
  id: string;
  parentThreadId: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  environmentPath: string | null;
  environmentHostId: string | null;
  hasPendingInteraction: boolean;
  status: string;
  queuedWork: "none" | "waiting" | "failed";
  lastReadAt: number | null;
  latestAttentionAt: number;
  activity: {
    activeBackgroundAgentCount: number;
    activeBackgroundCommandCount: number;
    activeWorkflowCount: number;
    activePlanModeCount: number;
    activeGoalCount: number;
  };
}

export function factsOf(
  row: ServerThreadRow,
  record: { lastActivityAt: number | null } | null,
  now: number,
): LiveFacts & { bbWord: "Queued" | "Planning" | "Goal" | null } {
  const turnRunning = isTurnInFlight(row.status as Parameters<typeof isTurnInFlight>[0]);
  const activity = row.activity;
  const background = activity.activeBackgroundAgentCount + activity.activeBackgroundCommandCount + activity.activeWorkflowCount;
  const lastSignal = Math.max(row.updatedAt, row.latestAttentionAt, record?.lastActivityAt ?? -Infinity);
  const bbWord: "Queued" | "Planning" | "Goal" | null =
    row.queuedWork === "waiting" ? "Queued" : activity.activePlanModeCount > 0 ? "Planning" : activity.activeGoalCount > 0 ? "Goal" : null;
  return {
    turnRunning,
    pending: row.hasPendingInteraction,
    failure: row.status === "error" || row.queuedWork === "failed",
    background,
    unread: !turnRunning && row.latestAttentionAt > (row.lastReadAt ?? 0),
    silentMin: Math.max(0, (now - lastSignal) / 60_000),
    bbWord,
  };
}
