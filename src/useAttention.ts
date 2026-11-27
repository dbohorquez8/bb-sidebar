import { createContext, useEffect, useMemo, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSidebarThreadDraftIds,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { AttentionRulesState } from "./attention-rules-state";
import type { bbSidebarRpcContract } from "./server";
import {
  ATTENTION_CHANNEL,
  ATTENTION_RULES_CHANNEL,
  backgroundWorkCount,
  parseTicketId,
  selectedTicketPrefixes,
  SILENCE_THRESHOLD_DEFAULT_MINUTES,
  type AttentionView,
  type BbWord,
  type ResolvedStatus,
} from "./attention";
import type { CardView } from "./attention/card-view";
import { composeWorld, type Composer } from "./attention/compose";
import { relativeTimeLabel } from "./relative-time";
import { threadWorktreeName } from "./inbox";
import { useSidebarSettings } from "./useSidebarSettings";

export type ChimeListener = (sound: "needs-you" | "done", threadId: string) => void;

export interface AttentionModel {
  viewFor(threadId: string): AttentionView | null;
  isNeedsYou(threadId: string): boolean;
  needsYouSince(threadId: string): number | null;
  silenceThresholdMinutes: number;
  /**
   * One entry per non-archived thread the composer holds a card for (the card's word, or "none" when idle).
   * Chimes no longer come from changes here: the composer plays them (see `onChime`). The map tells
   * `useChime` which threads are tracked.
   */
  chimeStatuses: ReadonlyMap<string, string>;
  /**
   * Increments each time a composer load has settled, success or failure: on mount and after each
   * realtime reconnect.
   */
  loadGeneration: number;
  /** Subscribes to the chimes the composer decides to play (WS-268, LC-11); returns the unsubscribe. */
  onChime?: (listener: ChimeListener) => () => void;
}

export const AttentionContext = createContext<AttentionModel | null>(null);

const IDLE_CARD: CardView = { word: null, count: null, text: null, tone: null, icon: "none", pill: false, hint: null, bar: null, timeLabel: null };
const EMPTY_CARDS: ReadonlyMap<string, CardView> = new Map();

function sameStatuses(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [threadId, key] of a) {
    if (b.get(threadId) !== key) return false;
  }
  return true;
}

const BB_WORDS: Readonly<Record<string, BbWord>> = { Draft: "draft", Queued: "queued", Planning: "planning", Goal: "goal" };
const NEEDS_YOU_WORDS: ReadonlySet<string> = new Set(["Needs you", "Asking", "Approval"]);
const END_WORDS: ReadonlySet<string> = new Set(["Stopped", "Wrapped", "Handed over", "Landed", "Done", "Verified"]);

/** The coarse status other parts of the sidebar (glyphs, child lists) still read, taken from the card. */
function statusOfCard(card: CardView): ResolvedStatus {
  const word = card.word;
  if (word === null) return { kind: "idle" };
  const bbWord = BB_WORDS[word];
  if (bbWord !== undefined) return { kind: "bb-word", word: bbWord };
  if (NEEDS_YOU_WORDS.has(word)) return { kind: "needs-you" };
  if (word === "Failed") return { kind: "failed" };
  if (word === "Check?") return { kind: "check" };
  if (word === "Finalized") return { kind: "finalized" };
  if (END_WORDS.has(word)) return { kind: "done" };
  if (card.tone === "green") return { kind: "background" };
  return { kind: "working" };
}

/**
 * Computes, for the sidebar's whole live thread set, the card view and Needs you placement every card reads
 * from `AttentionContext`.
 *
 * The cards come from the composer (`attention/compose.ts`), which fetches `getThreadCards` on mount, on a
 * short poll, and for ids named by an `ATTENTION_CHANNEL` message, and plays the chimes. The global rules state
 * is still read for ticket prefixes.
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

  // Null until the global rules state has loaded.
  const [rulesState, setRulesState] = useState<Pick<AttentionRulesState, "document" | "version"> | null>(null);

  const callRef = useRef(call);
  callRef.current = call;
  const draftRef = useRef(draftThreadIds);
  draftRef.current = draftThreadIds;

  const [composer, setComposer] = useState<Composer | null>(null);
  const composerRef = useRef<Composer | null>(null);
  composerRef.current = composer;
  const [version, setVersion] = useState(0);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const mountedRef = useRef(true);

  const listenersRef = useRef(new Set<ChimeListener>());
  const onChime = useMemo(
    () => (listener: ChimeListener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const loadComposer = (c: Composer): void => {
    void c.load().finally(() => {
      if (mountedRef.current && composerRef.current === c) setLoadGeneration((generation) => generation + 1);
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    const c = composeWorld({
      callRpc: (method, input) => (callRef.current as (m: string, i?: unknown) => Promise<unknown>)(method, input),
      chimePlayer: {
        play: (sound, threadId) => {
          for (const listener of [...listenersRef.current]) listener(sound, threadId);
        },
      },
      overlay: (threadId) => ({ draft: draftRef.current.has(threadId) }),
      onChange: () => {
        if (mountedRef.current) setVersion((v) => v + 1);
      },
    });
    composerRef.current = c;
    setComposer(c);
    loadComposer(c);
    return () => {
      mountedRef.current = false;
      c.dispose();
    };
    // Runs once on mount; reconnects and channels cover later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime(ATTENTION_CHANNEL, (payload: unknown) => {
    const threadIds = (payload as { threadIds?: unknown } | null)?.threadIds;
    if (!Array.isArray(threadIds)) return;
    composerRef.current?.notify(threadIds.filter((id): id is string => typeof id === "string"));
  });

  const loadRules = async (): Promise<void> => {
    try {
      const { document, version: rulesVersion } = await call("getAttentionRules", {});
      setRulesState((current) =>
        current && current.version === rulesVersion && current.document === document ? current : { document, version: rulesVersion },
      );
    } catch {
      // Keep whatever state is already known.
    }
  };
  useEffect(() => {
    void loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRealtime(ATTENTION_RULES_CHANNEL, () => {
    void loadRules();
  });

  // A reconnect drops what changed while offline: the composer loads again and takes a new chime baseline.
  const connectionState = useRealtimeConnectionState();
  const previousConnectionRef = useRef(connectionState);
  useEffect(() => {
    const previous = previousConnectionRef.current;
    previousConnectionRef.current = connectionState;
    if (connectionState === "connected" && previous !== "connected" && composerRef.current) {
      loadComposer(composerRef.current);
      void loadRules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  const cards = useMemo(
    () => composer?.cards() ?? EMPTY_CARDS,
    // `version` is a fetch counter; the draft set and the clock change what `cards()` answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composer, version, draftThreadIds, options.now],
  );

  const needsYouSinceRef = useRef(new Map<string, number>());
  const views = useMemo(() => {
    const out = new Map<string, AttentionView>();
    const ticketPrefixes = selectedTicketPrefixes(rulesState?.document);
    const needsYouSince = needsYouSinceRef.current;
    const wallNow = Date.now();
    for (const thread of threads) {
      if (thread.isArchived) continue;
      const card = cards.get(thread.id) ?? IDLE_CARD;
      const background = {
        workers: thread.activity.backgroundAgents,
        commands: thread.activity.backgroundCommands,
        workflows: thread.activity.workflows,
      };
      const ticket = parseTicketId(
        {
          title: thread.title ?? thread.titleFallback ?? "",
          branchName: thread.environment?.branchName ?? null,
          worktreeName: threadWorktreeName(thread),
        },
        ticketPrefixes,
      );
      const ageLabel = relativeTimeLabel(thread.updatedAt, options.now);
      if (card.word !== null && NEEDS_YOU_WORDS.has(card.word)) {
        if (!needsYouSince.has(thread.id)) needsYouSince.set(thread.id, wallNow);
      } else {
        needsYouSince.delete(thread.id);
      }
      out.set(thread.id, {
        status: statusOfCard(card),
        label: card.word,
        timeLabel: card.timeLabel,
        since: null,
        ruleLabel: null,
        ticket,
        background,
        backgroundCount: backgroundWorkCount(background),
        accessibleText:
          card.text === null ? ageLabel : card.timeLabel !== null ? `${card.text}, ${card.timeLabel}` : card.text,
        card,
      });
    }
    return out;
  }, [threads, cards, rulesState, options.now]);

  const chimeStatusesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const chimeStatuses = useMemo(() => {
    const next = new Map<string, string>();
    for (const thread of threads) {
      if (thread.isArchived) continue;
      const card = cards.get(thread.id);
      if (card !== undefined) next.set(thread.id, card.word ?? "none");
    }
    if (sameStatuses(next, chimeStatusesRef.current)) return chimeStatusesRef.current;
    chimeStatusesRef.current = next;
    return next;
  }, [threads, cards]);

  return useMemo<AttentionModel>(
    () => ({
      viewFor: (threadId) => views.get(threadId) ?? null,
      isNeedsYou: (threadId) => {
        const word = views.get(threadId)?.card.word ?? null;
        return word !== null && NEEDS_YOU_WORDS.has(word);
      },
      needsYouSince: (threadId) => {
        const word = views.get(threadId)?.card.word ?? null;
        return word !== null && NEEDS_YOU_WORDS.has(word) ? (needsYouSinceRef.current.get(threadId) ?? null) : null;
      },
      silenceThresholdMinutes,
      chimeStatuses,
      loadGeneration,
      onChime,
    }),
    [views, silenceThresholdMinutes, chimeStatuses, loadGeneration, onChime],
  );
}
