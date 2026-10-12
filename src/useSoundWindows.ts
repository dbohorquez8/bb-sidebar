import type { SoundWindow } from "./sounds/browser";

/**
 * Reports this window to the server registry on mount, every HEARTBEAT_MS
 * (window.clock), and at once on a change of focus, blocked state, or
 * activeThreadId; applies the snapshot from the response and from
 * SOUND_WINDOWS_CHANNEL; calls leaveSoundWindow on unmount and on `pagehide`.
 */
export function useSoundWindows(
  _window: SoundWindow,
  _activeThreadId: string | null,
): {
  playingWindowId: string | null;
  isPlayingWindow: boolean;
  /** The server snapshot's active thread, except: when this window has focus, its own activeThreadId. */
  activeThreadId: string | null;
} {
  throw new Error("not implemented");
}
