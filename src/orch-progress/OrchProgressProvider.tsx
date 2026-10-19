import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "../server";
import { groupForThread, mergeReadings, type OrchHeld } from "./select";
import type { OrchGroupModel } from "./state";

export const OrchProgressContext = createContext<ReadonlyMap<string, OrchGroupModel>>(new Map());

function sameModels(left: ReadonlyMap<string, OrchGroupModel>, right: ReadonlyMap<string, OrchGroupModel>): boolean {
  return left.size === right.size && [...left].every(([id, group]) => right.get(id) === group);
}

/** Polls the server while the document is visible and exposes a group per caller thread. */
export function OrchProgressProvider({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const { threads } = useSidebarThreads();
  const [models, setModels] = useState<ReadonlyMap<string, OrchGroupModel>>(new Map());
  const held = useRef<OrchHeld>(new Map());
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isHidden = () => document.visibilityState === "hidden";
    function publish(nextHeld: OrchHeld) {
      const next = new Map<string, OrchGroupModel>();
      for (const thread of threadsRef.current) {
        const group = groupForThread(nextHeld, thread);
        if (group) next.set(thread.id, group);
      }
      if (!disposed) setModels((previous) => sameModels(previous, next) ? previous : next);
    }
    async function refresh() {
      if (disposed || inFlight || isHidden()) return;
      inFlight = true;
      try {
        const result = await rpc.call("getOrchestratorGroups", {});
        const next = mergeReadings(held.current, result);
        held.current = next;
        publish(next);
      } finally {
        inFlight = false;
        if (!disposed && !isHidden()) timer = setTimeout(refresh, 10_000);
      }
    }
    function visibilityChanged() {
      clearTimeout(timer);
      if (!isHidden()) void refresh();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [rpc]);

  return <OrchProgressContext.Provider value={models}>{children}</OrchProgressContext.Provider>;
}

export function useOrchGroup(thread: PluginSidebarThread): OrchGroupModel | null {
  const models = useContext(OrchProgressContext);
  return thread.host?.id ? models.get(thread.id) ?? null : null;
}
