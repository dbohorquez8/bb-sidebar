// Which entries are audible (spec "When a sound does not play"). Pure.
import type { ChimeEntry } from "./entries";
import type { SoundSettings } from "./settings";

/**
 * The owner's put-away choice, kept in its own table (`thread_put_away`) that
 * `thread.active` handling and the lifecycle row's automatic return never
 * touch. Written by park, snooze, settle (manual and automatic); deleted only
 * by the owner's take-back actions (spec Terms "Put away").
 */
export interface PutAwayRecord {
  threadId: string;
  kind: "parked" | "snoozed" | "settled";
  /** When the choice was made. */
  since: number;
  /** Set only for kind "snoozed". */
  snoozedUntil: number | null;
}

/**
 * Put away at `at`: a record exists, and it is not a snooze whose time has
 * passed (kind !== "snoozed" || snoozedUntil > at). An undefined record is not
 * put away.
 */
export function isPutAway(_record: PutAwayRecord | undefined, _at: number): boolean {
  throw new Error("not implemented");
}

export interface AudibleContext {
  settings: SoundSettings;
  /** isPutAway for the entry's thread at entry.learnedAt. */
  putAway: boolean;
  /** The active thread across all BB windows at entry.learnedAt (null when no BB window has focus). */
  activeThreadId: string | null;
}

/** settings.playSounds && that status's switch && !putAway && threadId !== activeThreadId. */
export function isAudibleEntry(_entry: ChimeEntry, _ctx: AudibleContext): boolean {
  throw new Error("not implemented");
}
