import { useEffect, useMemo, useRef } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { bbSidebarRpcContract } from "./server";
import type { AttentionModel } from "./useAttention";
import type { LifecycleApi } from "./useLifecycle";
import { useSoundSettings } from "./useSoundSettings";
import { useSoundWindows } from "./useSoundWindows";
import { useSoundWindow } from "./sounds/browser";
import {
  CUTOFF_MS,
  decidePlayback,
  detectEntries,
  isAudibleEntry,
  scheduleEntries,
  startListening,
  type EntryTracker,
  type PlayRequest,
  type QuietPeriod,
  type ThreadSnapshot,
} from "./sounds";

/**
 * Composes the pure sound core for this window and starts sounds. Mounted
 * once, in ThreadInbox, after useAttention and useLifecycle. Calls no React
 * state setter: it reads hooks, writes refs, calls RPCs, schedules its own
 * timers, and starts sounds.
 *
 * Render-loop guard (plan App contract): every piece of state lives in a ref;
 * the entry effect runs on `snapshot` only and reads settings, put-away
 * records, and the windows snapshot through refs assigned during render; at
 * most one playback timer is pending per window.
 */
export function useChime({
  threads,
  attention,
  lifecycle,
  activeThreadId,
}: {
  threads: readonly PluginSidebarThread[];
  attention: AttentionModel;
  lifecycle: LifecycleApi;
  activeThreadId: string | null;
}): void {
  const soundWindow = useSoundWindow();
  const { settings } = useSoundSettings();
  const windows = useSoundWindows(soundWindow, activeThreadId);
  const connectionState = useRealtimeConnectionState();
  const rpc = useRpc<typeof bbSidebarRpcContract>();

  const snapshot = useMemo<ThreadSnapshot>(
    () => ({
      statuses: attention.chimeStatuses,
      createdAt: new Map(threads.map((thread) => [thread.id, thread.createdAt] as const)),
      archived: new Set(threads.filter((thread) => thread.isArchived).map((thread) => thread.id)),
    }),
    [attention.chimeStatuses, threads],
  );

  // Same-render values, read by effects and timers without triggering them.
  const current = useRef({ soundWindow, settings, windows, lifecycle, snapshot, rpc });
  current.current = { soundWindow, settings, windows, lifecycle, snapshot, rpc };

  const trackerRef = useRef<EntryTracker | null>(null);
  const processedRef = useRef<ThreadSnapshot["statuses"] | null>(null);
  const quietRef = useRef<QuietPeriod | null>(null);
  const pendingRef = useRef<PlayRequest[]>([]);
  const baselineAfterRef = useRef(0);
  const previousActiveThreadIdRef = useRef(activeThreadId);
  const timerRef = useRef<{ clock: typeof soundWindow.clock; handle: unknown } | null>(null);
  const claimsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const clearTimer = () => {
    if (timerRef.current) timerRef.current.clock.clearTimeout(timerRef.current.handle);
    timerRef.current = null;
  };

  const claimAndPlay = async (play: PlayRequest) => {
    const { soundWindow: w, rpc: client } = current.current;
    const key = `${play.threadId}\0${play.status}\0${play.learnedAt}`;
    if (claimsRef.current.has(key)) return;
    claimsRef.current.add(key);
    let granted = false;
    try {
      ({ granted } = await client.call("claimSoundPlay", {
        windowId: w.windowId,
        threadId: play.threadId,
        status: play.status,
      }));
    } catch {
      granted = false; // A failed claim is a denied one.
    } finally {
      claimsRef.current.delete(key);
    }
    if (!granted || !mountedRef.current) return;
    // A sound that cannot start changes nothing else.
    w.output.play(play.sound, play.volume).catch(() => undefined);
  };

  const runPlaybackRef = useRef<() => void>(() => {});
  runPlaybackRef.current = () => {
    clearTimer();
    if (!mountedRef.current) return;
    const { soundWindow: w, windows: soundWindows, lifecycle: life, snapshot: snap } = current.current;
    const now = w.clock.now();
    const { start, keep } = decidePlayback(pendingRef.current, {
      now,
      isPlayingWindow: soundWindows.isPlayingWindow,
      isTracked: (threadId) => snap.statuses.has(threadId) && !snap.archived.has(threadId),
      isPutAway: (threadId) => life.putAwayFor(threadId, now),
    });
    pendingRef.current = keep;
    for (const play of start) void claimAndPlay(play);
    if (keep.length > 0) {
      const oldest = Math.min(...keep.map((play) => play.learnedAt));
      const handle = w.clock.setTimeout(() => runPlaybackRef.current(), oldest + CUTOFF_MS - now + 1);
      timerRef.current = { clock: w.clock, handle };
    }
  };

  // Entries: on every change of the resolved statuses while listening.
  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker || processedRef.current === snapshot.statuses) return;
    processedRef.current = snapshot.statuses;
    const { soundWindow: w, settings: soundSettings, windows: soundWindows, lifecycle: life } = current.current;
    const at = w.clock.now();
    const detected = detectEntries(tracker, snapshot, at);    trackerRef.current = detected.tracker;
    const audible = detected.entries.filter((entry) =>
      isAudibleEntry(entry, {
        settings: soundSettings,
        putAway: life.putAwayFor(entry.threadId, at),
        activeThreadId: soundWindows.activeThreadId,
      }),
    );
    if (audible.length === 0) return;
    const scheduled = scheduleEntries(quietRef.current, audible, soundSettings);
    quietRef.current = scheduled.quiet;
    pendingRef.current = [...pendingRef.current, ...scheduled.plays];
    runPlaybackRef.current();
  }, [snapshot]);

  // Playback: when this window is elected, the thread list changes, or a
  // thread is put away while its play waits.
  useEffect(() => {
    runPlaybackRef.current();
  }, [windows.isPlayingWindow, snapshot, lifecycle.putAwayRecords]);

  // Listening: the baseline is the first full load that settles while connected.
  useEffect(() => {
    if (connectionState !== "connected") {
      trackerRef.current = null;
      pendingRef.current = [];
      clearTimer();
      baselineAfterRef.current = attention.loadGeneration;
      return;
    }
    if (trackerRef.current === null && attention.loadGeneration > baselineAfterRef.current) {
      const { soundWindow: w, snapshot: snap } = current.current;
      trackerRef.current = startListening(snap, w.clock.now());
      processedRef.current = snap.statuses;
    }
  }, [attention.loadGeneration, connectionState]);

  // Opening a put-away thread in the focused pane takes it back. The first
  // route value this mount sees is not an opening.
  useEffect(() => {
    if (activeThreadId === previousActiveThreadIdRef.current) return;
    previousActiveThreadIdRef.current = activeThreadId;
    if (activeThreadId !== null) void current.current.lifecycle.takeBack(activeThreadId);
  }, [activeThreadId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, []);
}
