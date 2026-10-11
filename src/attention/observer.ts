// Server-only: the one attention file that touches the server SDK at runtime
// (bb.events.on, bb.sdk.threads.events.list, bb.sdk.threads.output,
// bb.realtime.publish) and the plugin database.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AttentionPreset, ThreadObservation } from "./types";

export function createAttentionObserver(
  bb: BbPluginApi,
  deps: {
    db: ReturnType<BbPluginApi["storage"]["database"]>;
    now?: () => number;
    presets?: readonly AttentionPreset[];
    concurrency?: number; // threads synced at once by list(); default 4
  },
): {
  list(
    threads: readonly { id: string; parentId: string | null }[],
  ): Promise<{ observations: ThreadObservation[]; unavailable: string[] }>;
  sync(threadId: string, finalReplyHint?: string | null): Promise<"changed" | "unchanged" | "unavailable">;
} {
  throw new Error("not implemented");
}
