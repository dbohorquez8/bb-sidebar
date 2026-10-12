import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { HEARTBEAT_MS, type SoundWindowsSnapshot } from "./sounds";
import type { SoundWindow } from "./sounds/browser";

// server.ts's SOUND_WINDOWS_CHANNEL; the app bundle imports no server values.
const SOUND_WINDOWS_CHANNEL = "sound-windows";

const NO_SNAPSHOT: SoundWindowsSnapshot = { playingWindowId: null, activeThreadId: null };

function readSnapshot(raw: unknown): SoundWindowsSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { playingWindowId, activeThreadId } = raw as Record<string, unknown>;
  const idOrNull = (value: unknown) => (typeof value === "string" ? value : null);
  return { playingWindowId: idOrNull(playingWindowId), activeThreadId: idOrNull(activeThreadId) };
}

/**
 * Reports this window to the server registry on mount, every HEARTBEAT_MS
 * (window.clock), and at once on a change of focus, blocked state, or
 * activeThreadId; applies the snapshot from the response and from
 * SOUND_WINDOWS_CHANNEL; calls leaveSoundWindow on unmount and on `pagehide`.
 *
 * Input (pointerdown/keydown) only moves the focus source's lastInputAt, which
 * is read when the next report is sent: typing causes no RPC and no render.
 * React state changes only when a received snapshot differs from the held one.
 */
export function useSoundWindows(
  soundWindow: SoundWindow,
  activeThreadId: string | null,
): {
  playingWindowId: string | null;
  isPlayingWindow: boolean;
  /** The server snapshot's active thread, except: when this window has focus, its own activeThreadId. */
  activeThreadId: string | null;
} {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const { windowId, focus, output, clock } = soundWindow;
  const focused = useSyncExternalStore(focus.subscribe, focus.hasFocus);
  const blocked = useSyncExternalStore(output.subscribe, output.isBlocked);
  const [snapshot, setSnapshot] = useState<SoundWindowsSnapshot>(NO_SNAPSHOT);

  const current = useRef({ focused, blocked, activeThreadId });
  current.current = { focused, blocked, activeThreadId };
  const reportSeq = useRef(0);
  const live = useRef(false);

  const apply = useCallback((next: SoundWindowsSnapshot | null) => {
    if (!next || !live.current) return;
    setSnapshot((held) =>
      held.playingWindowId === next.playingWindowId && held.activeThreadId === next.activeThreadId
        ? held
        : next,
    );
  }, []);

  const report = useCallback(async () => {
    if (!live.current) return;
    const seq = ++reportSeq.current;
    const { focused: isFocused, blocked: isBlocked, activeThreadId: active } = current.current;
    try {
      const answer = await rpc.call("reportSoundWindow", {
        windowId,
        focused: isFocused,
        activeThreadId: active,
        soundBlocked: isBlocked,
        lastInputAt: focus.lastInputAt(),
      });
      // A newer report (or a leave) has been sent since; its answer wins.
      if (seq === reportSeq.current) apply(readSnapshot(answer));
    } catch {
      void 0; // The next heartbeat retries.
    }
  }, [rpc, windowId, focus, apply]);

  // Mount, leave, and the heartbeat.
  useEffect(() => {
    live.current = true;
    let timer: unknown = null;
    const beat = () => {
      timer = clock.setTimeout(beat, HEARTBEAT_MS);
      void report();
    };
    timer = clock.setTimeout(beat, HEARTBEAT_MS);
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      reportSeq.current += 1;
      void rpc.call("leaveSoundWindow", { windowId }).catch(() => undefined);
    };
    const onPageHide = () => {
      live.current = false;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      leave();
    };
    globalThis.addEventListener?.("pagehide", onPageHide);
    return () => {
      globalThis.removeEventListener?.("pagehide", onPageHide);
      live.current = false;
      if (timer !== null) clock.clearTimeout(timer);
      leave();
    };
  }, [clock, report, rpc, windowId]);

  // At once on mount and on a change of focus, blocked state, or the focused pane's thread.
  useEffect(() => {
    void report();
  }, [report, focused, blocked, activeThreadId]);

  useRealtime(SOUND_WINDOWS_CHANNEL, (payload: unknown) => {
    apply(readSnapshot(payload));
  });

  return {
    playingWindowId: snapshot.playingWindowId,
    isPlayingWindow: snapshot.playingWindowId === windowId,
    activeThreadId: focused ? activeThreadId : snapshot.activeThreadId,
  };
}
