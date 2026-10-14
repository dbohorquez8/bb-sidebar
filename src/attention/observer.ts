// Server-only: the one attention file that touches the server SDK at runtime
// (bb.events.on, bb.sdk.threads.events.list, bb.sdk.threads.output,
// bb.realtime.publish) and the plugin database.
//
// The thread_attention rows are a cache plus the reading position, never the
// truth: list() reconciles every listed thread with BB's event history before
// it answers, so a reload or restart cannot show a stale status.
//
// One sequence space: every read is filtered with HISTORY_EVENT_TYPES and
// cursorSeq only ever holds a seq those filtered reads returned. The change
// signal's `sequence` is never used as a position.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  applyObservationEvent,
  coldReadComplete,
  COLD_READ_MAX_ROWS,
  finalReplyTurn,
  HISTORY_EVENT_TYPES,
  HISTORY_PAGE_SIZE,
  countSlicesInPlan,
  mergeChildSteps,
  mergeSliceProgress,
  parseStoredObservation,
  rowsToObservationEvents,
  sliceNumberOf,
} from "./observation";
import { ATTENTION_PRESETS } from "./presets";
import { ATTENTION_CHANNEL } from "./settings";
import type { AttentionPreset, ObservedStep, ThreadEventRowLike, ThreadObservation } from "./types";

const CHILD_SCAN_LIMIT = 20; // newest children read per parent
const CHILD_SCAN_TTL_MS = 30_000; // events cover changes between scans

type SliceReport = { feature: string; slice: number; finished: boolean; at: number; planTotal: number | null };

type SyncResult = "changed" | "unchanged" | "unavailable";

interface SyncOutcome {
  result: SyncResult;
  /** Every thread whose stored record changed: the thread and a bumped parent. */
  changedIds: string[];
  /** When this sync read the history; null when it could not. */
  observedAt: number | null;
}

// Migration 23's text. The observer also runs it, so it works on any plugin
// database it is handed; IF NOT EXISTS keeps that a no-op after the migration.
export const THREAD_ATTENTION_TABLE = `CREATE TABLE IF NOT EXISTS thread_attention (
  thread_id TEXT PRIMARY KEY,
  record    TEXT NOT NULL
)`;

function emptyObservation(threadId: string, observedAt: number): ThreadObservation {
  return {
    v: 2,
    threadId,
    cursorSeq: null,
    turnStartedAt: null,
    turnEndedAt: null,
    reply: null,
    steps: {},
    lastActivityAt: null,
    interactionAt: null,
    observedAt,
  };
}

// Key-sorted JSON so a record read back from storage compares equal to the
// same record built in memory. observedAt is left out: it moves on every sync.
function comparable(record: ThreadObservation | undefined): string {
  if (!record) return "";
  const { observedAt: _observedAt, ...rest } = record;
  return JSON.stringify(rest, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : value,
  );
}

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
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const presets = deps.presets ?? ATTENTION_PRESETS;
  const concurrency = Math.max(1, Math.floor(deps.concurrency ?? 4));
  db.exec(THREAD_ATTENTION_TABLE);

  // parentId per thread, as last reported by list() or a thread event.
  const parents = new Map<string, string | null>();
  // One promise chain per thread id, so two syncs never fold the same rows.
  const chains = new Map<string, Promise<unknown>>();

  function serialized<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(threadId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    chains.set(threadId, tail);
    void tail.then(() => {
      if (chains.get(threadId) === tail) chains.delete(threadId);
    });
    return next;
  }

  function readRecord(threadId: string): ThreadObservation | undefined {
    const row = db.prepare(`SELECT record FROM thread_attention WHERE thread_id = ?`).get(threadId) as
      | { record: string }
      | undefined;
    if (!row) return undefined;
    try {
      const parsed = parseStoredObservation(JSON.parse(row.record));
      return parsed && parsed.threadId === threadId ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  function writeRecord(record: ThreadObservation): void {
    db.prepare(
      `INSERT INTO thread_attention (thread_id, record) VALUES (?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET record = excluded.record`,
    ).run(record.threadId, JSON.stringify(record));
  }

  function deleteRecord(threadId: string): void {
    db.prepare(`DELETE FROM thread_attention WHERE thread_id = ?`).run(threadId);
    parents.delete(threadId);
  }

  async function readPage(
    threadId: string,
    position: { order: "asc"; afterSeq: number } | { order: "desc"; beforeSeq: number | null },
  ): Promise<ThreadEventRowLike[]> {
    const rows = await bb.sdk.threads.events.list({
      threadId,
      types: HISTORY_EVENT_TYPES,
      order: position.order,
      limit: String(HISTORY_PAGE_SIZE),
      ...(position.order === "asc"
        ? { afterSeq: String(position.afterSeq) }
        : position.beforeSeq === null
          ? {}
          : { beforeSeq: String(position.beforeSeq) }),
    });
    return rows as ThreadEventRowLike[];
  }

  // Everything filtered after the cursor, ascending.
  async function readForward(threadId: string, cursorSeq: number): Promise<ThreadEventRowLike[]> {
    const rows: ThreadEventRowLike[] = [];
    let afterSeq = cursorSeq;
    for (;;) {
      const page = await readPage(threadId, { order: "asc", afterSeq });
      rows.push(...page);
      if (page.length < HISTORY_PAGE_SIZE) break;
      afterSeq = Math.max(afterSeq, ...page.map((row) => row.seq));
    }
    return rows;
  }

  // A thread with no record: newest first until the rows answer every
  // question the record holds, the history starts, or the cap is reached.
  async function readCold(threadId: string): Promise<ThreadEventRowLike[]> {
    const newestFirst: ThreadEventRowLike[] = [];
    let beforeSeq: number | null = null;
    for (;;) {
      const page = await readPage(threadId, { order: "desc", beforeSeq });
      newestFirst.push(...page);
      if (page.length < HISTORY_PAGE_SIZE) break;
      if (coldReadComplete(newestFirst, presets)) break;
      if (newestFirst.length >= COLD_READ_MAX_ROWS) break;
      beforeSeq = Math.min(...page.map((row) => row.seq));
    }
    return newestFirst.sort((a, b) => a.seq - b.seq);
  }

  async function finalReplyText(threadId: string, hint: string | null | undefined): Promise<string | null> {
    if (hint !== undefined) return hint;
    const response = await bb.sdk.threads.output({ threadId });
    return response.output;
  }

  async function syncThread(
    threadId: string,
    hint: string | null | undefined,
  ): Promise<{ result: SyncResult; newestAt: number | null; observedAt: number | null }> {
    const stored = readRecord(threadId);
    let next: ThreadObservation;
    let rows: ThreadEventRowLike[];
    try {
      rows =
        stored && stored.cursorSeq !== null
          ? await readForward(threadId, stored.cursorSeq)
          : await readCold(threadId);

      const events = rowsToObservationEvents(rows);
      const replyTurn = finalReplyTurn(rows);
      if (replyTurn) {
        // The k-th completed turn row is the k-th turn-ended event.
        const completedSeqs = rows
          .filter((row) => row.type === "turn/completed" && (row.data as { status?: string })?.status === "completed")
          .map((row) => row.seq);
        const target = completedSeqs.indexOf(replyTurn.seq);
        // The reply text lives only inside this call: it is matched in
        // applyObservationEvent and never stored, logged, or published.
        const text = await finalReplyText(threadId, hint);
        let seen = -1;
        for (let index = 0; index < events.length; index += 1) {
          const event = events[index]!;
          if (event.kind !== "turn-ended") continue;
          seen += 1;
          if (seen === target) {
            events[index] = { ...event, finalReply: text };
            break;
          }
        }
      }

      next = stored ?? emptyObservation(threadId, now());
      for (const event of events) next = applyObservationEvent(next, threadId, event, presets);
    } catch {
      return { result: "unavailable", newestAt: null, observedAt: null };
    }
    next = { ...next, observedAt: now() };

    const changed = !stored || comparable(stored) !== comparable(next);
    if (changed) writeRecord(next);
    const newestAt = rows.length > 0 ? Math.max(...rows.map((row) => row.createdAt)) : null;
    return { result: changed ? "changed" : "unchanged", newestAt, observedAt: next.observedAt };
  }

  // A child's own rows count as its parent's background activity, and its
  // workflow steps count as the parent's (newest wins, resets respected).
  async function bumpParent(
    parentId: string,
    at: number | null,
    childSteps: Readonly<Record<string, ObservedStep>>,
    slice: SliceReport | null,
  ): Promise<boolean> {
    return serialized(parentId, async () => {
      const stored = readRecord(parentId);
      let next = stored ?? emptyObservation(parentId, now());
      if (at !== null) next = applyObservationEvent(next, parentId, { kind: "background-activity", at }, presets);
      next = mergeChildSteps(next, childSteps, presets);
      if (slice) next = mergeSliceProgress(next, slice, slice.planTotal);
      if (stored && comparable(stored) === comparable(next)) return false;
      writeRecord(next);
      return true;
    });
  }

  // Slice number per child id: filled from the SDK child in scanChildren (it
  // carries environmentName/environmentPath), else resolved once by threads.get.
  // list() hands over only ids and the event `thread` has no environment name.
  const sliceOf = new Map<string, { feature: string; slice: number } | null>();
  const environmentNameOf = (thread: { environmentName?: string | null; environmentPath?: string | null }) =>
    thread.environmentName ?? thread.environmentPath?.split("/").filter(Boolean).pop() ?? null;

  async function resolveSlice(childId: string): Promise<{ feature: string; slice: number } | null> {
    if (sliceOf.has(childId)) return sliceOf.get(childId) ?? null;
    try {
      const thread = await bb.sdk.threads.get({ threadId: childId });
      const found = sliceNumberOf(environmentNameOf(thread as never));
      sliceOf.set(childId, found);
      return found;
    } catch {
      return null; // not cached: try again next sync
    }
  }

  // The plan's slice count, read with the 30 s scan TTL so it follows edits.
  const planTotals = new Map<string, { at: number; total: number | null }>();
  async function planTotalFor(parentId: string, feature: string): Promise<number | null> {
    const key = `${parentId}\u0000${feature}`;
    const cached = planTotals.get(key);
    if (cached && now() - cached.at < CHILD_SCAN_TTL_MS) return cached.total;
    let total: number | null = null;
    try {
      const parent = await bb.sdk.threads.get({ threadId: parentId });
      const projectId = (parent as { projectId?: string | null }).projectId;
      const environmentId = (parent as { environmentId?: string | null }).environmentId;
      if (projectId && environmentId) {
        const found = await bb.sdk.projects.paths({
          projectId,
          environmentId,
          includeFiles: "true",
          includeDirectories: "false",
          limit: "100",
          query: `${feature}/slices.md`,
        } as never);
        const matches = found.paths
          .map((entry) => entry.path)
          .filter((path) => new RegExp(`^docs/features/[^/]*-${feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/slices\\.md$`).test(path));
        if (matches.length === 1) {
          const file = await bb.sdk.projects.fileContent({ projectId, environmentId, path: matches[0]! });
          const content = (file as { content?: string }).content;
          total = typeof content === "string" ? countSlicesInPlan(content) : null;
        }
      }
    } catch {
      total = null;
    }
    planTotals.set(key, { at: now(), total });
    return total;
  }

  async function sliceReport(
    childId: string,
    parentId: string,
    child: ThreadObservation,
  ): Promise<SliceReport | null> {
    const found = await resolveSlice(childId);
    if (!found) return null;
    return {
      ...found,
      finished: child.reply !== null,
      at: child.turnEndedAt ?? child.turnStartedAt ?? 0,
      planTotal: await planTotalFor(parentId, found.feature),
    };
  }

  async function syncWithParent(threadId: string, hint?: string | null): Promise<SyncOutcome> {
    const outcome = await serialized(threadId, () => syncThread(threadId, hint));
    const changedIds = outcome.result === "changed" ? [threadId] : [];
    const parentId = parents.get(threadId) ?? null;
    if (parentId !== null && parentId !== threadId) {
      const childRecord = readRecord(threadId);
      const childSteps = childRecord?.steps ?? {};
      const hasSteps = Object.keys(childSteps).length > 0;
      // Hidden and visible slice workers both pass here, so each counts once.
      const slice = childRecord ? await sliceReport(threadId, parentId, childRecord) : null;
      if (
        (outcome.newestAt !== null || hasSteps || slice !== null) &&
        (await bumpParent(parentId, outcome.newestAt, childSteps, slice))
      ) {
        changedIds.push(parentId);
      }
    }
    return { result: outcome.result, changedIds, observedAt: outcome.observedAt };
  }

  // Children of a thread, hidden and archived included, newest first. Archived
  // ones fold into the parent once per process: their record is dropped after.
  const childScanAt = new Map<string, number>();
  const foldedArchived = new Set<string>();
  async function scanChildren(parentId: string, skip: ReadonlySet<string>): Promise<void> {
    const last = childScanAt.get(parentId);
    if (last !== undefined && now() - last < CHILD_SCAN_TTL_MS) return;
    childScanAt.set(parentId, now());
    let children: Awaited<ReturnType<typeof bb.sdk.threads.list>>;
    try {
      children = await bb.sdk.threads.list({ parentThreadId: parentId, includeHidden: "true", limit: "100" } as never);
    } catch {
      return;
    }
    const newest = [...children]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, CHILD_SCAN_LIMIT);
    for (const child of newest) {
      if (skip.has(child.id)) continue;
      const archived = child.archivedAt !== null && child.archivedAt !== undefined;
      if (archived && foldedArchived.has(child.id)) continue;
      parents.set(child.id, parentId);
      if (!sliceOf.has(child.id)) sliceOf.set(child.id, sliceNumberOf(environmentNameOf(child as never)));
      await syncWithParent(child.id);
      if (archived) {
        foldedArchived.add(child.id);
        deleteRecord(child.id);
      }
    }
  }

  function rememberParent(thread: { id: string; parentThreadId?: string | null }): void {
    if (thread.parentThreadId !== undefined) parents.set(thread.id, thread.parentThreadId);
  }

  async function syncAndPublish(threadId: string, hint?: string | null): Promise<void> {
    try {
      const { changedIds } = await syncWithParent(threadId, hint);
      if (changedIds.length > 0) bb.realtime.publish(ATTENTION_CHANNEL, { threadIds: changedIds });
    } catch (error) {
      bb.log.error(
        `Attention sync failed for thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  bb.events.on("thread.active", async ({ thread }) => {
    rememberParent(thread);
    await syncAndPublish(thread.id);
  });
  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    rememberParent(thread);
    await syncAndPublish(thread.id, lastAssistantText);
  });
  // thread.failed and turn.failed both trigger on purpose: the second sync
  // reads no new rows, so it neither writes nor publishes.
  bb.events.on("thread.failed", async ({ thread }) => {
    rememberParent(thread);
    await syncAndPublish(thread.id);
  });
  bb.events.on("turn.failed", async ({ threadId }) => {
    await syncAndPublish(threadId);
  });
  bb.events.on("interaction.pending", async ({ thread }) => {
    rememberParent(thread);
    await syncAndPublish(thread.id);
  });
  bb.events.on("experimental_thread.events", async ({ thread }) => {
    rememberParent(thread);
    await syncAndPublish(thread.id);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    deleteRecord(thread.id);
  });
  bb.events.on("thread.archived", ({ thread }) => {
    deleteRecord(thread.id);
  });

  return {
    async list(threads) {
      for (const thread of threads) parents.set(thread.id, thread.parentId);
      const ids = [...new Set(threads.map((thread) => thread.id))];
      const unavailable = new Set<string>();
      const observedAt = new Map<string, number>();
      let index = 0;
      const worker = async () => {
        while (index < ids.length) {
          const threadId = ids[index++]!;
          const outcome = await syncWithParent(threadId);
          if (outcome.observedAt === null) unavailable.add(threadId);
          else observedAt.set(threadId, outcome.observedAt);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

      // Hidden and archived workers are not in the requested set; their steps
      // reach their parent through this scan.
      const requested = new Set(ids);
      let scanIndex = 0;
      const scanner = async () => {
        while (scanIndex < ids.length) {
          const threadId = ids[scanIndex++]!;
          if (unavailable.has(threadId)) continue;
          await scanChildren(threadId, requested).catch(() => undefined);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, scanner));

      // Read back after every sync: a child's bump may have moved its parent.
      const observations: ThreadObservation[] = [];
      for (const threadId of ids) {
        if (unavailable.has(threadId)) continue;
        const stored = readRecord(threadId);
        if (stored) observations.push({ ...stored, observedAt: observedAt.get(threadId) ?? stored.observedAt });
      }
      return { observations, unavailable: ids.filter((id) => unavailable.has(id)) };
    },
    async sync(threadId, finalReplyHint) {
      const { result } = await syncWithParent(threadId, finalReplyHint);
      return result;
    },
  };
}
