import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { AttentionModel } from "./useAttention";
import type { LifecycleApi } from "./useLifecycle";

/**
 * Composes the pure sound core for this window and starts sounds. Mounted
 * once, in ThreadInbox, after useAttention and useLifecycle. Calls no React
 * state setter: it reads hooks, writes refs, calls RPCs, schedules its own
 * timers, and starts sounds.
 */
export function useChime(_args: {
  threads: readonly PluginSidebarThread[];
  attention: AttentionModel;
  lifecycle: LifecycleApi;
  activeThreadId: string | null;
}): void {
  throw new Error("not implemented");
}
