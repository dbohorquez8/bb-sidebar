import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { shortModelName } from "./attention";

type RpcClient = ReturnType<typeof useRpc<typeof bbSidebarRpcContract>>;

interface CacheEntry {
  model: string | null;
  promise: Promise<string | null> | null;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(threadId: string, revision: number): string {
  return `${threadId}:${revision}`;
}

function fetchModel(rpc: RpcClient, threadId: string, revision: number): Promise<string | null> {
  const key = cacheKey(threadId, revision);
  const existing = cache.get(key);
  if (existing?.promise) return existing.promise;

  const promise = rpc
    .call("getThreadExecutionDetails", { threadId })
    .then((details) => details?.model ?? null)
    .catch(() => null);

  cache.set(key, { model: existing?.model ?? null, promise });
  void promise.then((model) => {
    cache.set(key, { model, promise: null });
  });
  return promise;
}

/**
 * A thread's current model name, fetched once per `(threadId, revision)` with
 * a module-level cache and in-flight dedupe. `enabled` is the card's own
 * visibility flag, so an off-screen card makes no call.
 */
export function useThreadModel(
  threadId: string,
  enabled: boolean,
  revision: number,
): string | null {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const key = cacheKey(threadId, revision);
  const [model, setModel] = useState<string | null>(() => cache.get(key)?.model ?? null);

  useEffect(() => {
    setModel(cache.get(key)?.model ?? null);
    if (!enabled) return;
    let cancelled = false;
    void fetchModel(rpc, threadId, revision).then((result) => {
      if (!cancelled) setModel(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return model;
}

/** Renders `shortModelName(useThreadModel(...))` as the last line's model text, or nothing. */
export function ThreadModelText({
  threadId,
  enabled,
  revision,
}: {
  threadId: string;
  enabled: boolean;
  revision: number;
}): React.ReactElement | null {
  const model = useThreadModel(threadId, enabled, revision);
  const short = shortModelName(model);
  if (short === null) return null;
  return <span className="shrink-0 font-mono">{short}</span>;
}
