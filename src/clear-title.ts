import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { createTitleRegenerator } from "./regenerate-title";

// A reused thread keeps its old title after /clear (WS-71). The first prompt
// after the clear names the new work, unless it only resumes the old work.
// A resume command in any plugin namespace (`/catchup`, `/plugin:catchup`), or a
// resume phrase.
const CONTINUATION_COMMAND = /^\/(?:[\w-]+:)?(?:catchup|implement)(?![\w:-])/;
const CONTINUATION_PHRASE = /^(?:continue|keep going|pick up where)\b/;
const RECENT_ROW_LIMIT = 20;
const WAITING_RETRIES = 2;
const WAITING_RETRY_MS = 1_000;
const MESSAGE_CHAR_LIMIT = 8_000; // same cap as the last-messages title path

export const CLEAR_RETITLE_MIGRATION = `CREATE TABLE IF NOT EXISTS clear_retitle_handled (
  clear_key TEXT PRIMARY KEY
)`;

interface EventRow {
  seq: number;
  type: string;
  data: unknown;
}

export function isContinuationPrompt(text: string): boolean {
  const start = text.trim().toLowerCase();
  return CONTINUATION_COMMAND.test(start) ||
    CONTINUATION_PHRASE.test(start);
}

function isCompletedClear(row: EventRow): boolean {
  if (row.type !== "system/operation") return false;
  const data = row.data as { operation?: string; status?: string };
  return data.operation === "context_clear" && data.status === "completed";
}

function userPromptText(row: EventRow): string | null {
  if (row.type !== "client/turn/requested") return null;
  const data = row.data as { initiator?: string; input?: Array<{ type?: string; text?: string }> };
  if (data.initiator !== "user") return null;
  return (data.input ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("\n")
    .trim();
}

/**
 * The newest clear and its prompt when exactly one user prompt follows it;
 * "waiting" when no prompt follows it yet; otherwise null.
 */
export function pendingClearRetitle(
  rowsNewestFirst: readonly EventRow[],
): { clearKey: string; text: string } | "waiting" | null {
  const prompts: string[] = [];
  for (const row of rowsNewestFirst) {
    if (isCompletedClear(row)) {
      if (prompts.length === 0) return "waiting";
      if (prompts.length !== 1) return null;
      const operationId = (row.data as { operationId?: string | null }).operationId;
      return { clearKey: operationId ?? `seq:${row.seq}`, text: prompts[0] };
    }
    const text = userPromptText(row);
    // The /clear command itself is not the next prompt.
    if (text !== null && text.toLowerCase() !== "/clear") prompts.push(text);
    if (prompts.length > 1) return null;
  }
  return null;
}

/** Rename a titled thread from the first new-work prompt after each /clear. */
export function createClearRetitle(
  bb: BbPluginApi,
  regenerateTitle: ReturnType<typeof createTitleRegenerator>,
) {
  const db = bb.storage.database();
  const claim = db.prepare("INSERT OR IGNORE INTO clear_retitle_handled (clear_key) VALUES (?)");
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });

  async function check(threadId: string, retriesLeft: number) {
    try {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        types: ["system/operation", "client/turn/requested"],
        order: "desc",
        limit: String(RECENT_ROW_LIMIT),
      });
      if (disposed) return;
      const pending = pendingClearRetitle(rows as EventRow[]);
      // The turn can start before BB records its request row: look again shortly.
      if (pending === "waiting" && retriesLeft > 0) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          void check(threadId, retriesLeft - 1);
        }, WAITING_RETRY_MS);
        timer.unref?.();
        timers.add(timer);
        return;
      }
      if (pending === null || pending === "waiting") return;
      if (claim.run(`${threadId}:${pending.clearKey}`).changes === 0) return;
      if (!pending.text || isContinuationPrompt(pending.text)) return;
      await regenerateTitle(threadId, { messages: [pending.text.slice(0, MESSAGE_CHAR_LIMIT)] });
    } catch (error) {
      if (!disposed) bb.log.info(
        `Title after clear did not complete for ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  bb.events.on("thread.active", async ({ thread }) => {
    // Untitled threads belong to automatic title recovery.
    if (disposed || thread.title === null || thread.visibility !== "visible" ||
        thread.archivedAt !== null || thread.deletedAt !== null) return;
    await check(thread.id, WAITING_RETRIES);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    db.prepare("DELETE FROM clear_retitle_handled WHERE clear_key LIKE ? ESCAPE '\\'")
      .run(`${thread.id.replace(/[\\%_]/g, "\\$&")}:%`);
  });
}
