import { createContext, useEffect, useMemo, useRef, useState } from "react";
import {
  useRealtime,
  useRpc,
  useSidebarThreadDraftIds,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { isWorkingIndicator } from "./child-status";
import type { bbSidebarRpcContract } from "./server";
import {
  ATTENTION_CHANNEL,
  ATTENTION_PRESETS,
  PROJECT_ATTENTION_CHANNEL,
  attentionInputFromThread,
  backgroundSignature,
  buildAttentionView,
  currentStage,
  historySince,
  isSilentPastThreshold,
  parseProjectAttention,
  parseTicketId,
  reconcileFailedAck,
  reconcileStatusSince,
  readFailedAck,
  readStatusSince,
  resolveAttentionStatus,
  silenceOrigin,
  statusKey,
  verdictFor,
  writeFailedAck,
  writeStatusSince,
  SILENCE_THRESHOLD_DEFAULT_MINUTES,
  type AttentionInput,
  type AttentionView,
  type ProjectAttentionSettings,
  type ResolvedStatus,
  type StatusSinceEntry,
  type ThreadObservation,
} from "./attention";
import { isInactiveThread } from "./inactive";
import { relativeTimeLabel } from "./relative-time";
import { threadWorktreeName } from "./inbox";
import { useSidebarSettings } from "./useSidebarSettings";

export interface AttentionModel {
  viewFor(threadId: string): AttentionView | null;
  isNeedsYou(threadId: string): boolean;
  needsYouSince(threadId: string): number | null;
  silenceThresholdMinutes: number;
}

export const AttentionContext = createContext<AttentionModel | null>(null);

const EMPTY_PROJECT_SETTINGS: ProjectAttentionSettings = { enabledPresets: [], ticketPrefixes: [] };

interface ResolvedThread {
  status: ResolvedStatus;
  input: AttentionInput;
  observation: ThreadObservation | null;
  view: AttentionView;
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
 * for ids named by an `ATTENTION_CHANNEL` message, and `getProjectAttention`
 * on mount and on `PROJECT_ATTENTION_CHANNEL`. A thread with no record yet,
 * or named in `unavailable`, resolves from BB's live thread fields alone.
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
  const [projectSettings, setProjectSettings] = useState<
    ReadonlyMap<string, ProjectAttentionSettings>
  >(() => new Map());

  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const backgroundSignatureRef = useRef<Map<string, { signature: string; at: number }>>(new Map());

  const loadAttention = async (ids: readonly { id: string; parentId: string | null }[]) => {
    if (ids.length === 0) return;
    try {
      const result = await call("listAttention", { threads: ids.slice(0, 1000) });
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
    } catch {
      // The host has no RPC yet, or the call failed: cards fall back to BB's
      // own live state until the next successful load.
    }
  };

  const threadIdsKey = threads.map((thread) => `${thread.id}:${thread.parentThreadId ?? ""}`).join("\0");
  useEffect(() => {
    void loadAttention(
      threads
        .filter((thread) => !thread.isArchived)
        .map((thread) => ({ id: thread.id, parentId: thread.parentThreadId })),
    );
    // threadIdsKey captures every id/parent pair this effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadIdsKey]);

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

  const loadProjectAttention = async () => {
    try {
      const result = await call("getProjectAttention", {});
      const next = new Map<string, ProjectAttentionSettings>();
      for (const [projectId, raw] of Object.entries(result.projects)) {
        next.set(projectId, parseProjectAttention(raw, ATTENTION_PRESETS).settings);
      }
      setProjectSettings(next);
    } catch {
      // Keep whatever settings are already known; every project defaults to
      // DEFAULT_PROJECT_ATTENTION until a row loads.
    }
  };

  useEffect(() => {
    void loadProjectAttention();
    // Runs once on mount; PROJECT_ATTENTION_CHANNEL covers later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime(PROJECT_ATTENTION_CHANNEL, () => {
    void loadProjectAttention();
  });

  const [statusSince, setStatusSince] = useState<ReadonlyMap<string, StatusSinceEntry>>(
    () => readStatusSince(),
  );
  const [failedAck, setFailedAck] = useState<ReadonlySet<string>>(() => readFailedAck());
  const previousActiveThreadIdRef = useRef<string | null>(options.activeThreadId);

  const resolved = useMemo(() => {
    const byThreadId = new Map<string, ResolvedThread>();
    const now = options.now;
    const wallNow = Date.now();

    for (const rawThread of threads) {
      if (rawThread.isArchived) continue;
      const thread = withDraft(rawThread, draftThreadIds.has(rawThread.id));

      const observation = unavailable.has(thread.id) ? null : (observations.get(thread.id) ?? null);
      const settings = projectSettings.get(thread.projectId) ?? EMPTY_PROJECT_SETTINGS;
      const verdict = verdictFor(observation?.reply ?? null, settings.enabledPresets);

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

      const input = attentionInputFromThread(thread, {
        verdict,
        silent,
        onInactiveShelf,
        failureAcknowledged: failedAck.has(thread.id),
      });
      const status = resolveAttentionStatus(input);

      const since = statusSince.get(thread.id);
      const statusSinceValue =
        since && since.key === statusKey(status) ? since.since : wallNow;

      const openInThisWindow =
        thread.id === options.activeThreadId || options.openThreadIds.has(thread.id);

      const ticket = parseTicketId(
        {
          title: thread.title ?? thread.titleFallback ?? "",
          branchName: thread.environment?.branchName ?? null,
          worktreeName: threadWorktreeName(thread),
        },
        settings.ticketPrefixes,
      );
      const stage = currentStage(observation?.steps ?? {}, settings.enabledPresets);

      const view = buildAttentionView({
        status,
        statusSince: statusSinceValue,
        silenceOrigin: origin,
        unreadResult: input.unreadResult,
        openInThisWindow,
        stage,
        ticket,
        background: liveBackground,
        ageLabel: relativeTimeLabel(thread.updatedAt, now),
        now,
      });

      byThreadId.set(thread.id, { status, input, observation, view });
    }
    return byThreadId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    threads,
    draftThreadIds,
    observations,
    unavailable,
    projectSettings,
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
      if (entry.input.failureReported) failing.add(threadId);
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
    }),
    [resolved, statusSince, silenceThresholdMinutes],
  );
}
