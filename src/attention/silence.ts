import type { BackgroundWork } from "./types";

export const SILENCE_THRESHOLD_DEFAULT_MINUTES = 15;
export const SILENCE_THRESHOLD_MIN_MINUTES = 1;
export const SILENCE_THRESHOLD_MAX_MINUTES = 1440;

export function silenceOrigin(input: {
  turnEndedAt: number | null; // from the history
  lastActivityAt: number | null; // latest of the record's lastActivityAt and the app-observed count change
  firstSeenAt: number; // the app's first sighting of the thread in this mount
}): number {
  throw new Error("not implemented");
}

export function isSilentPastThreshold(origin: number, now: number, thresholdMinutes: number): boolean {
  throw new Error("not implemented");
}

export function validateSilenceThreshold(
  raw: string,
): { ok: true; minutes: number } | { ok: false; reason: string } {
  throw new Error("not implemented");
}

export function backgroundSignature(work: BackgroundWork): string {
  throw new Error("not implemented");
}
