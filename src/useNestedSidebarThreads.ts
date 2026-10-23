import { useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { missingParentIds, nestThroughHiddenParents } from "./hidden-parents";

const RETRY_MS = 30_000;

// Lookups in flight, shared by every caller (the list and the header chips
// all ask about the same threads at the same moment).
const inFlight = new Map<string, Promise<Record<string, string | null>>>();

/**
 * The sidebar's live threads, with each child of a hidden thread pointed at
 * its nearest visible ancestor. For display only: anything that changes a
 * thread's parent must read the real one from `useSidebarThreads`.
 */
export function useNestedSidebarThreads(): ReturnType<typeof useSidebarThreads> {
  const state = useSidebarThreads();
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const missing = useMemo(() => missingParentIds(state.threads), [state.threads]);
  const key = missing.join("\0");
  const [hiddenParents, setHiddenParents] = useState<Record<string, string | null>>({});
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lookup = inFlight.get(key);
    if (!lookup) {
      lookup = rpcRef.current
        .call("listHiddenParents", { threadIds: key.split("\0").slice(0, 200) })
        .then((result) => result.parents);
      inFlight.set(key, lookup);
      const settled = () => inFlight.delete(key);
      lookup.then(settled, settled);
    }
    lookup.then(
      (parents) => { if (!cancelled) setHiddenParents(parents); },
      // A backend reload or a failed thread read: try again shortly.
      () => { if (!cancelled) timer = setTimeout(() => setRetry((count) => count + 1), RETRY_MS); },
    );
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, retry]);

  const threads = useMemo(
    () => nestThroughHiddenParents(state.threads, hiddenParents),
    [state.threads, hiddenParents],
  );
  return threads === state.threads ? state : { ...state, threads };
}
