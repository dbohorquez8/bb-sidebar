// The 3-second cutoff and the start/keep/drop decision. Pure.
import type { PlayRequest } from "./quiet";

export const CUTOFF_MS = 3_000;

/** now - play.learnedAt <= CUTOFF_MS. */
export function canStart(_play: PlayRequest, _now: number): boolean {
  throw new Error("not implemented");
}

/**
 * ok(p) = canStart(p, now) && isTracked(p.threadId) && !isPutAway(p.threadId)
 * start:   isPlayingWindow && ok(p)
 * keep:    !isPlayingWindow && ok(p)   (waits for a takeover, AC-24)
 * dropped: everything else (past the cutoff, the thread archived/deleted, or
 *          the thread put away since its entry — AC-08, AC-49, Edge Case
 *          "Entry and put-away in the same update")
 */
export function decidePlayback(
  _pending: readonly PlayRequest[],
  _ctx: {
    now: number;
    isPlayingWindow: boolean;
    isTracked(threadId: string): boolean;
    /** isPutAway(record, now). */
    isPutAway(threadId: string): boolean;
  },
): { start: PlayRequest[]; keep: PlayRequest[]; dropped: PlayRequest[] } {
  throw new Error("not implemented");
}
