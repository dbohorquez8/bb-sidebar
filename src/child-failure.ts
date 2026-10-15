import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * How recent an errored child's last update must be to show Failed. An older
 * failure under a parent that is still open stays quiet (WS-51).
 */
export const CHILD_FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ChildFailureContext {
  /** Whether the child's parent thread is archived (a settled branch). */
  parentArchived: boolean;
  /** Whether the owner has opened the failing child (the acknowledged set). */
  acknowledged: boolean;
  now: number;
}

/**
 * BB never flags a child thread as unread, so its indicator stays "none" even
 * when it errored. A child shows Failed from its own status instead, but only
 * while it is live work: errored, not archived, under an open parent, not yet
 * opened by the owner, and failed within CHILD_FAILURE_WINDOW_MS.
 */
export function childFailureReported(
  thread: PluginSidebarThread,
  context: ChildFailureContext,
): boolean {
  return (
    thread.parentThreadId != null &&
    thread.status === "error" &&
    !thread.isArchived &&
    !context.parentArchived &&
    !context.acknowledged &&
    context.now - thread.updatedAt <= CHILD_FAILURE_WINDOW_MS
  );
}
