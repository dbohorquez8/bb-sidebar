// Window reports, the playing-window choice, the active thread, and the
// server's claim ledger. Pure; the clock is injected.
import type { ChimeStatus } from "./entries";

export const HEARTBEAT_MS = 1_000;
/** A report older than this is a closed or frozen window. */
export const WINDOW_TTL_MS = 2_500;
/** Server sweep; worst-case handover ≈ 3.5 s < 5 s (AC-23). */
export const PRUNE_INTERVAL_MS = 1_000;
/** CUTOFF_MS + 1 s of learn-time spread between windows; server clock only. */
export const CLAIM_MATCH_MS = 4_000;
export const CLAIM_RETENTION_MS = 10_000;

export interface SoundWindowReport {
  windowId: string;
  /** The computer has this BB window in focus (not minimized, not behind another app). */
  focused: boolean;
  /** The thread in this window's focused pane (PluginThreadListProps.activeThreadId). */
  activeThreadId: string | null;
  soundBlocked: boolean;
  /** Last pointerdown/keydown in this window; null before any. */
  lastInputAt: number | null;
  seenAt: number;
}

export interface SoundWindowsSnapshot {
  playingWindowId: string | null;
  /** The active thread across windows (Terms "Active thread"); null when no BB window has focus. */
  activeThreadId: string | null;
}

/**
 * Candidates: reports with now - seenAt <= WINDOW_TTL_MS and !soundBlocked (AC-22).
 * 1. a focused candidate wins;
 * 2. else `current`, if it is still a candidate (no flapping);
 * 3. else the candidate with the greatest lastInputAt (null lowest);
 * ties: smallest windowId. No candidate: null.
 */
export function choosePlayingWindow(
  windows: readonly SoundWindowReport[],
  current: string | null,
  now: number,
): string | null {
  const candidates = windows.filter((w) => now - w.seenAt <= WINDOW_TTL_MS && !w.soundBlocked);
  if (candidates.length === 0) return null;
  const byId = (a: SoundWindowReport, b: SoundWindowReport) => (a.windowId < b.windowId ? -1 : a.windowId > b.windowId ? 1 : 0);
  const focused = candidates.filter((w) => w.focused).sort(byId);
  if (focused.length > 0) return focused[0].windowId;
  if (current !== null && candidates.some((w) => w.windowId === current)) return current;
  const input = (w: SoundWindowReport) => w.lastInputAt ?? Number.NEGATIVE_INFINITY;
  return [...candidates].sort((a, b) => input(b) - input(a) || byId(a, b))[0].windowId;
}

/** activeThreadId of the fresh focused report (blocked windows included); several focused: greatest seenAt; none: null. */
export function activeThreadOf(windows: readonly SoundWindowReport[], now: number): string | null {
  let best: SoundWindowReport | null = null;
  for (const w of windows) {
    if (!w.focused || now - w.seenAt > WINDOW_TTL_MS) continue;
    if (best === null || w.seenAt > best.seenAt) best = w;
  }
  return best?.activeThreadId ?? null;
}

/** No window-local time is sent: windows' clocks and learn times differ (remote tabs, slow refetches). */
export interface SoundClaim {
  windowId: string;
  threadId: string;
  status: ChimeStatus;
}

/** Server-side, in memory, one per plugin server process. */
export interface SoundWindowRegistry {
  report(report: Omit<SoundWindowReport, "seenAt">): SoundWindowsSnapshot;
  leave(windowId: string): SoundWindowsSnapshot;
  /** Drops stale reports and old claims; returns the snapshot only when it changed. */
  prune(): SoundWindowsSnapshot | null;
  snapshot(): SoundWindowsSnapshot;
  /**
   * Grants at most one claim per entry. The registry stamps each claim with
   * its own now() on receipt; a claim is denied when a claim for the same
   * threadId and status was granted at a server time within CLAIM_MATCH_MS
   * before it. Assumption (not an invariant): every window learns of an entry
   * within 1 s of the first window, so each window's claim (made at most
   * CUTOFF_MS after it learned) lands within that span. A window that learns
   * more than 1 s late and is elected more than 4 s after the first grant can
   * play the entry again (Spec / Reality Mismatch 11).
   */
  claim(claim: SoundClaim): boolean;
}

export function createSoundWindowRegistry(now: () => number): SoundWindowRegistry {
  const reports = new Map<string, SoundWindowReport>();
  /** Last time each (threadId, status) claim was granted, on this registry's clock. */
  const grants = new Map<string, number>();
  let playing: string | null = null;
  let published: SoundWindowsSnapshot = { playingWindowId: null, activeThreadId: null };

  const compute = (): SoundWindowsSnapshot => {
    const t = now();
    const list = [...reports.values()];
    playing = choosePlayingWindow(list, playing, t);
    return { playingWindowId: playing, activeThreadId: activeThreadOf(list, t) };
  };
  const publish = (): SoundWindowsSnapshot => {
    published = compute();
    return published;
  };

  return {
    report(report) {
      reports.set(report.windowId, { ...report, seenAt: now() });
      return publish();
    },
    leave(windowId) {
      reports.delete(windowId);
      return publish();
    },
    prune() {
      const t = now();
      for (const [id, r] of reports) if (t - r.seenAt > WINDOW_TTL_MS) reports.delete(id);
      for (const [key, at] of grants) if (t - at > CLAIM_RETENTION_MS) grants.delete(key);
      const next = compute();
      if (next.playingWindowId === published.playingWindowId && next.activeThreadId === published.activeThreadId) return null;
      published = next;
      return next;
    },
    snapshot: compute,
    claim({ threadId, status }) {
      const t = now();
      const key = JSON.stringify([threadId, status]);
      const last = grants.get(key);
      if (last !== undefined && t - last <= CLAIM_MATCH_MS) return false;
      grants.set(key, t);
      return true;
    },
  };
}
