import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { CONTEXT_USAGE_CHANNEL } from "./context-usage";
import { cn } from "./lib/utils";

export interface ContextUsage {
  /** How full the model's context window is, in whole percent. */
  percent: number | null;
  /** Usage against the context-ring soft limit; drives the colour. */
  zonePercent: number | null;
}

const EMPTY: ContextUsage = { percent: null, zonePercent: null };

/**
 * A thread's context-window fill. Fetched when the
 * card becomes visible, then kept current by the server's push when a turn
 * changes it.
 */
export function useThreadContextUsage(threadId: string, enabled: boolean): ContextUsage {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [usage, setUsage] = useState<ContextUsage>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void rpc
      .call("getThreadContextUsage", { threadId })
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, enabled]);

  useRealtime(
    CONTEXT_USAGE_CHANNEL,
    useCallback(
      (payload: unknown) => {
        const next = payload as ({ threadId?: string } & Partial<ContextUsage>) | null;
        if (next?.threadId !== threadId) return;
        setUsage({ percent: next.percent ?? null, zonePercent: next.zonePercent ?? null });
      },
      [threadId],
    ),
  );

  return usage;
}

/** The context-ring zones: red at the soft limit, orange past 75%, muted below. */
function zoneTone(zonePercent: number | null): string {
  if (zonePercent === null) return "text-muted-foreground";
  if (zonePercent >= 100) return "text-[color:var(--ws-red-text)]";
  if (zonePercent >= 75) return "text-[color:var(--ws-orange-text)]";
  return "text-muted-foreground";
}

export function ThreadContextPercent({ usage }: { usage: ContextUsage }) {
  if (usage.percent === null) return null;
  return (
    <span
      aria-label={`Context window ${usage.percent}% full`}
      className={cn("shrink-0 font-medium leading-none tabular-nums", zoneTone(usage.zonePercent))}
    >
      {usage.percent}%
    </span>
  );
}
