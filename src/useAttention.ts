import { createContext, useEffect, useMemo, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSidebarThreadDraftIds,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { isWorkingIndicator } from "./child-status";
import type { AttentionRulesState } from "./attention-rules-state";
import type { bbSidebarRpcContract } from "./server";
import {
  ATTENTION_CHANNEL,
  ATTENTION_RULES_CHANNEL,
  backgroundSignature,
  buildAttentionView,
  historySince,
  isSilentPastThreshold,
  parseTicketId,
  reconcileFailedAck,
  reconcileStatusSince,
  resolveAttentionStatus,
  selectedTicketPrefixes,
  silenceOrigin,
  statusKey,
  verdictFor,
  SILENCE_THRESHOLD_DEFAULT_MINUTES,
  type AttentionInput,
  type AttentionView,
  type ResolvedStatus,
  type StatusSinceEntry,
  type ThreadObservation,
} from "./attention";
import { attentionInputFromThread } from "./attention-thread-input";
import { readFailedAck, readStatusSince, writeFailedAck, writeStatusSince } from "./attention-since-storage";
import { isInactiveThread } from "./inactive";
import { relativeTimeLabel } from "./relative-time";
import { threadWorktreeName } from "./inbox";
import { useSidebarSettings } from "./useSidebarSettings";

export interface AttentionModel {
  viewFor(threadId: string): AttentionView | null;
  isNeedsYou(threadId: string): boolean;
  needsYouSince(threadId: string): number | null;
  silenceThresholdMinutes: number;
  /**
   * statusKey(status) per non-archived thread whose attention record has
   * loaded (present in observations or named in `unavailable`), and only after
   * the global attention rules state has loaded once. A thread is omitted until then.
   * While its record reloads after BB reports a status or indicator change for
   * it, a thread keeps the status it last had here.
   */
  chimeStatuses: ReadonlyMap<string, string>;
  /**
   * Increments each time a full load attempt (listAttention for every
   * non-archived thread, plus getAttentionRules) has settled, success or
   * failure: on mount and after each realtime reconnect.
   */
  loadGeneration: number;
}

export const AttentionContext = createContext<AttentionModel | null>(null);

/** A full load in which a call failed is retried after this long, until one succeeds. */
const FULL_LOAD_RETRY_MS = 5_000;

function sameStatuses(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [threadId, key] of a) {
    if (b.get(threadId) !== key) return false;
  }
  return true;
}

/** BB's own status and indicator for a thread; a change reloads its record. */
function bbStatusSignature(thread: PluginSidebarThread): string {
  return `${thread.status}\0${thread.indicator}`;
}

interface ResolvedThread {
  status: ResolvedStatus;
  input: AttentionInput;
  observation: ThreadObservation | null;
  view: AttentionView;
  /** BB reports a failure, acknowledged or not (reconcileFailedAck's `failing`). */
  failing: boolean;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function later(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Folds an unsent composer draft into a thread's indicator the way
 * `StatusSlot`'s `useThreadWithDraft` does, so a thread with a draft resolves
 * to the same Draft/Drafting bb-word here as it would through the fallback
 * path. Drafts are per-client state the SDK keeps out of `indicator`.
 */
function withDraft(thread: PluginSidebarThread, hasDraft: boolean): PluginSidebarThread {
  if (!hasDraft) return thread;
  const indicator = isWorkingIndicator(thread.indicator)
    ? "working-draft"
    : thread.indicator === "none"
      ? "draft"
      : thread.indicator;
  if (indicator === thread.indicator) return thread;
  return {
    ...thread,
    indicator,
    indicatorLabel:
      indicator === "draft"
        ? "Thread has unsubmitted draft"
        : "Thread working with unsubmitted draft",
  };
}

/**
 * Computes, for the sidebar's whole live thread set, the attention status,
 * view, and Needs you placement every card reads from `AttentionContext`.
 *
 * Fetches `listAttention` for every non-archived thread on mount and again
 * for ids named by an `ATTENTION_CHANNEL` message, and `getAttentionRules`
 * (one global state, every project) on mount and on `ATTENTION_RULES_CHANNEL`.
 * A thread with no record yet, one named in `unavailable`, or one whose record
 * was made under other rules than the active ones resolves from BB's live
 * thread fields alone.
 */
export function useAttention(
  threads: readonly PluginSidebarThread[],
  options: {
    activeThreadId: string | null;
    now: number;
    inactiveAfterHours: number | null;
    openThreadIds: ReadonlySet<string>;
  },
): AttentionModel {
  const { call } = useRpc<typeof bbSidebarRpcContract>();
  const draftThreadIds = useSidebarThreadDraftIds();
  const sidebarSettings = useSidebarSettings();
  const silenceThresholdMinutes =
    sidebarSettings?.silenceThresholdMinutes ?? SILENCE_THRESHOLD_DEFAULT_MINUTES;

  const [observations, setObservations] = useState<ReadonlyMap<string, ThreadObservation>>(
    () => new Map(),
  );
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  // Null until the global rules state has loaded; then the active document (or
  // none) and its version. Custom behaviour is absent while this is null.
  const [rulesState, setRulesState] = useState<Pick<AttentionRulesState, "document" | "version"> | null>(null);

  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const backgroundSignatureRef = useRef<Map<string, { signature: string; at: number }>>(new Map());

  /**
   * Resolves true when the records loaded (or nothing needed loading).
   * `settled` runs once the call has answered, before its state lands.
   */
  const loadAttention = async (
    ids: readonly { id: string; parentId: string | null }[],
    settled?: () => void,
  ): Promise<boolean> => {
    if (ids.length === 0) return true;
    try {
      const result = await call("listAttention", { threads: ids.slice(0, 1000) });
      settled?.();
      setObservations((current) => {
        const next = new Map(current);
        for (const observation of result.observations) next.set(observation.threadId, observation);
        return next;
      });
      setUnavailable((current) => {
        const next = new Set(current);
        for (const { id } of ids) next.delete(id);
        for (const id of result.unavailable) next.add(id);
        return next;
      });
      return true;
    } catch {
      // The host has no RPC yet, or the call failed: cards fall back to BB's
      // own live state until the next successful load.
      if (settled) {
        settled();
        setReloadsSettled((count) => count + 1);
      }
      return false;
    }
  };

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const liveThreadIds = () =>
    threadsRef.current
      .filter((thread) => !thread.isArchived)
      .map((thread) => ({ id: thread.id, parentId: thread.parentThreadId }));

  const threadIdsKey = threads.map((thread) => `${thread.id}:${thread.parentThreadId ?? ""}`).join("\0");
  const firstThreadIdsRun = useRef(true);
  useEffect(() => {
    // The mount's full load (below) covers the first thread list.
    if (firstThreadIdsRun.current) {
      firstThreadIdsRun.current = false;
      return;
    }
    void loadAttention(liveThreadIds());
    // threadIdsKey captures every id/parent pair this effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadIdsKey]);

  // BB can announce a turn (`thread.active`) before the turn's rows exist, so
  // the record synced then still carries the previous reply, and a stale
  // Needs you verdict would outrank the running turn until it ends. Reloading
  // a thread's record when BB's own status or indicator for it changes reads
  // the new rows. Until that reload answers, the thread's status is left out
  // of chimeStatuses: BB's list can say a turn ended (and its result is
  // unread) before the record holds the final reply, and the status resolved
  // in between (Done in place of Needs you) must not count as an entry.
  const bbStatusRef = useRef<Map<string, string> | null>(null);
  /** Thread id → the latest status-change reload's sequence number, while it is in flight. */
  const reloadingRef = useRef<Map<string, number>>(new Map());
  const reloadSeqRef = useRef(0);
  const [reloadsSettled, setReloadsSettled] = useState(0);
  useEffect(() => {
    const previous = bbStatusRef.current;
    const next = new Map<string, string>();
    const changed: { id: string; parentId: string | null }[] = [];
    for (const thread of threads) {
      if (thread.isArchived) continue;
      const signature = bbStatusSignature(thread);
      next.set(thread.id, signature);
      const before = previous?.get(thread.id);
      if (before !== undefined && before !== signature) {
        changed.push({ id: thread.id, parentId: thread.parentThreadId });
      }
    }
    bbStatusRef.current = next;
    if (changed.length === 0) return;
    const seq = ++reloadSeqRef.current;
    for (const { id } of changed) reloadingRef.current.set(id, seq);
    void loadAttention(changed, () => {
      // A newer reload of the same thread keeps it out until that one answers.
      for (const { id } of changed) {
        if (reloadingRef.current.get(id) === seq) reloadingRef.current.delete(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  useRealtime(ATTENTION_CHANNEL, (payload: unknown) => {
    const threadIds = (payload as { threadIds?: unknown } | null)?.threadIds;
    if (!Array.isArray(threadIds)) return;
    const parentById = new Map(threads.map((thread) => [thread.id, thread.parentThreadId]));
    void loadAttention(
      threadIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => ({ id, parentId: parentById.get(id) ?? null })),
    );
  });

  const loadRules = async (): Promise<boolean> => {
    try {
      const { document, version } = await call("getAttentionRules", {});
      setRulesState((current) =>
        current && current.version === version && current.document === document ? current : { document, version },
      );
      return true;
    } catch {
      // Keep whatever state is already known; with none, cards use BB's own state.
      return false;
    }
  };

  useRealtime(ATTENTION_RULES_CHANNEL, () => {
    void loadRules();
  });

  // The full load: every live thread's record plus the global rules state, on
  // mount and after each realtime reconnect. Each settled attempt bumps
  // loadGeneration (useChime takes its baseline from it); a failed one is
  // retried every FULL_LOAD_RETRY_MS until one succeeds.
  const connectionState = useRealtimeConnectionState();
  const [loadGeneration, setLoadGeneration] = useState(0);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullLoadSeqRef = useRef(0);
  const cancelRetry = () => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };
  const fullLoad = async () => {
    cancelRetry();
    const seq = ++fullLoadSeqRef.current;
    const [recordsLoaded, settingsLoaded] = await Promise.all([
      loadAttention(liveThreadIds()),
      loadRules(),
    ]);
    if (!mountedRef.current) return;
    setLoadGeneration((generation) => generation + 1);
    // A newer full load (a reconnect) or a disconnect owns the retry now.
    if (seq !== fullLoadSeqRef.current) return;
    if (!recordsLoaded || !settingsLoaded) {
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void fullLoad();
      }, FULL_LOAD_RETRY_MS);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void fullLoad();
    return () => {
      mountedRef.current = false;
      cancelRetry();
    };
    // Runs once on mount; reconnects and channels cover later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousConnectionRef = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionRef.current;
    previousConnectionRef.current = connectionState;
    if (connectionState !== "connected") {
      // The reload on the return to "connected" replaces a pending retry.
      fullLoadSeqRef.current += 1;
      cancelRetry();
      return;
    }
    if (previous !== "connected") void fullLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  const [statusSince, setStatusSince] = useState<ReadonlyMap<string, StatusSinceEntry>>(
    () => readStatusSince(),
  );
  const [failedAck, setFailedAck] = useState<ReadonlySet<string>>(() => readFailedAck());
  const previousActiveThreadIdRef = useRef<string | null>(options.activeThreadId);

  const resolved = useMemo(() => {
    const byThreadId = new Map<string, ResolvedThread>();
    const now = options.now;
    const wallNow = Date.now();
    const threadsById = new Map(threads.map((t) => [t.id, t]));
    // One global list for every project (title and branch matching alike).
    const ticketPrefixes = selectedTicketPrefixes(rulesState?.document);

    for (const rawThread of threads) {
      if (rawThread.isArchived) continue;
      const thread = withDraft(rawThread, draftThreadIds.has(rawThread.id));

      const observation = unavailable.has(thread.id) ? null : (observations.get(thread.id) ?? null);
      // Only an outcome made under the active rules counts; a stale record is
      // withheld until the server rebuilds it.
      const activeVersion = rulesState?.version ?? null;
      const verdict = verdictFor(observation?.rules, activeVersion);
      const currentRules = activeVersion !== null && observation?.rules?.version === activeVersion ? observation.rules : null;

      const liveBackground = {
        workers: thread.activity.backgroundAgents,
        commands: thread.activity.backgroundCommands,
        workflows: thread.activity.workflows,
      };
      const signature = backgroundSignature(liveBackground);
      const previousSignature = backgroundSignatureRef.current.get(thread.id);
      if (!previousSignature || previousSignature.signature !== signature) {
        backgroundSignatureRef.current.set(thread.id, { signature, at: wallNow });
      }
      const countChangeAt = backgroundSignatureRef.current.get(thread.id)?.at ?? null;

      if (!firstSeenRef.current.has(thread.id)) firstSeenRef.current.set(thread.id, wallNow);
      const firstSeenAt = firstSeenRef.current.get(thread.id) as number;

      const onInactiveShelf = isInactiveThread(thread, now, options.inactiveAfterHours);

      const origin = silenceOrigin({
        turnEndedAt: observation?.turnEndedAt ?? null,
        lastActivityAt: later(observation?.lastActivityAt ?? null, countChangeAt),
        firstSeenAt,
      });
      const silent = isSilentPastThreshold(origin, now, silenceThresholdMinutes);

      const failureAcknowledged = failedAck.has(thread.id);
      // A missing parent is no longer live work. It must not revive an old
      // child's failure after its parent has gone away.
      const parentOpen =
        thread.parentThreadId != null &&
        threadsById.get(thread.parentThreadId)?.isArchived === false;
      const input = attentionInputFromThread(thread, {
        verdict,
        silent,
        onInactiveShelf,
        failureAcknowledged,
        parentOpen,
        now: wallNow,
      });
      const status = resolveAttentionStatus(input);
      // An acknowledged failure is still a reported one; reading the
      // post-acknowledgement flag would drop the acknowledgement next pass.
      const failing = failureAcknowledged
        ? attentionInputFromThread(thread, { verdict, silent, onInactiveShelf, failureAcknowledged: false, parentOpen, now: wallNow })
            .failureReported
        : input.failureReported;

      const since = statusSince.get(thread.id);
      const statusSinceValue =
        since && since.key === statusKey(status) ? since.since : wallNow;

      const ticket = parseTicketId(
        {
          title: thread.title ?? thread.titleFallback ?? "",
          branchName: thread.environment?.branchName ?? null,
          worktreeName: threadWorktreeName(thread),
        },
        ticketPrefixes,
      );

      const view = buildAttentionView({
        status,
        statusSince: statusSinceValue,
        silenceOrigin: origin,
        stage: null,
        ruleLabel: currentRules?.label
          ? {
              ...currentRules.label,
              ...(currentRules.label.progress === "slices" && observation?.slices && observation.slices.total >= 1
                ? { sliceProgress: { done: Math.min(observation.slices.done.length, observation.slices.total), total: observation.slices.total } }
                : {}),
            }
          : null,
        ticket,
        background: liveBackground,
        ageLabel: relativeTimeLabel(thread.updatedAt, now),
        now,
      });

      byThreadId.set(thread.id, { status, input, observation, view, failing });
    }
    return byThreadId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    threads,
    draftThreadIds,
    observations,
    unavailable,
    rulesState,
    options.now,
    options.activeThreadId,
    options.openThreadIds,
    options.inactiveAfterHours,
    silenceThresholdMinutes,
    statusSince,
    failedAck,
  ]);

  useEffect(() => {
    const currentKeys = new Map<string, string>();
    for (const [threadId, entry] of resolved) currentKeys.set(threadId, statusKey(entry.status));
    const nextSince = reconcileStatusSince(statusSince, currentKeys, Date.now(), (threadId) => {
      const entry = resolved.get(threadId);
      return entry ? historySince(entry.status, entry.input, entry.observation) : null;
    });
    if (nextSince !== statusSince) {
      setStatusSince(nextSince);
      writeStatusSince(nextSince);
    }

    const failing = new Set<string>();
    for (const [threadId, entry] of resolved) {
      if (entry.failing) failing.add(threadId);
    }
    const nextAck = reconcileFailedAck(
      failedAck,
      failing,
      options.activeThreadId,
      previousActiveThreadIdRef.current,
    );
    previousActiveThreadIdRef.current = options.activeThreadId;
    // reconcileFailedAck always returns a fresh Set (it has no "unchanged"
    // short-circuit the way reconcileStatusSince does), so a reference
    // comparison here would setState — and re-render — every single time.
    if (!setsEqual(nextAck, failedAck)) {
      setFailedAck(nextAck);
      writeFailedAck(nextAck);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // The chime's status source: only threads whose record has loaded, and only
  // once project settings have, so a first load never reads as a change. The
  // previous Map is kept while nothing differs (useChime's snapshot identity).
  // A thread whose record is reloading after a BB status change keeps the
  // status it last had here until the reload answers, so its next status is
  // compared with the last one useChime held (leaving it out would drop it
  // from useChime's held statuses, and its return would not count as an
  // entry). The render that first sees the change runs before the reload
  // effect, so a signature that differs from the last one seen also counts
  // as reloading.
  const chimeStatusesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const chimeStatuses = useMemo(() => {
    const next = new Map<string, string>();
    if (rulesState !== null) {
      const seen = bbStatusRef.current;
      const reloading = new Set(reloadingRef.current.keys());
      for (const thread of threads) {
        const before = seen?.get(thread.id);
        if (before !== undefined && before !== bbStatusSignature(thread)) reloading.add(thread.id);
      }
      for (const [threadId, entry] of resolved) {
        if (reloading.has(threadId)) {
          const held = chimeStatusesRef.current.get(threadId);
          if (held !== undefined) next.set(threadId, held);
          continue;
        }
        if (observations.has(threadId) || unavailable.has(threadId)) {
          next.set(threadId, statusKey(entry.status));
        }
      }
    }
    if (sameStatuses(next, chimeStatusesRef.current)) return chimeStatusesRef.current;
    chimeStatusesRef.current = next;
    return next;
  }, [threads, resolved, observations, unavailable, rulesState, reloadsSettled]);

  return useMemo<AttentionModel>(
    () => ({
      viewFor: (threadId) => resolved.get(threadId)?.view ?? null,
      isNeedsYou: (threadId) => resolved.get(threadId)?.status.kind === "needs-you",
      needsYouSince: (threadId) => {
        const entry = resolved.get(threadId);
        if (!entry || entry.status.kind !== "needs-you") return null;
        return statusSince.get(threadId)?.since ?? null;
      },
      silenceThresholdMinutes,
      chimeStatuses,
      loadGeneration,
    }),
    [resolved, statusSince, silenceThresholdMinutes, chimeStatuses, loadGeneration],
  );
}
