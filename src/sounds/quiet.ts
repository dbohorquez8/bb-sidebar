// The 1-second quiet period, same-update order, and play requests. Pure.
import type { SoundId } from "./catalog";
import type { ChimeEntry, ChimeStatus } from "./entries";
import type { SoundSettings } from "./settings";

export const QUIET_PERIOD_MS = 1_000;

export interface QuietPeriod {
  /** Exclusive end: an entry with learnedAt >= until is after the period. */
  until: number;
  /** The chime status of the audible entry that opened it. */
  openedBy: ChimeStatus;
}

export interface PlayRequest {
  threadId: string;
  status: ChimeStatus;
  /** settings.needsYouSound or settings.doneSound at entry time. */
  sound: SoundId;
  /** settings.volume at entry time, percent. */
  volume: number;
  learnedAt: number;
}

/**
 * `audible` holds only audible entries (callers filter with isAudibleEntry
 * first, so an inaudible entry never opens a period — AC-20). Processing order:
 * learnedAt ascending; within one learnedAt, needs-you before done (AC-48);
 * otherwise input order. For each entry at t:
 *  - no period, or t >= quiet.until: request a play; quiet = { until: t + 1000, openedBy: entry.status }.
 *  - inside a period with openedBy "done" and entry "needs-you": request a play;
 *    quiet = { until: t + 1000, openedBy: "needs-you" } (AC-19: replaces it; a later
 *    needs-you inside the new period is silent).
 *  - otherwise: no play, period unchanged (AC-17: no extension).
 * The period opens whether or not the requested play later starts (AC-49).
 */
export function scheduleEntries(
  _quiet: QuietPeriod | null,
  _audible: readonly ChimeEntry[],
  _settings: SoundSettings,
): { quiet: QuietPeriod | null; plays: PlayRequest[] } {
  throw new Error("not implemented");
}
