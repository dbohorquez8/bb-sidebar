import type { BackgroundWork } from "./types";

export const SILENCE_THRESHOLD_DEFAULT_MINUTES = 15;
export const SILENCE_THRESHOLD_MIN_MINUTES = 1;
export const SILENCE_THRESHOLD_MAX_MINUTES = 1440;

export function silenceOrigin(input: {
  turnEndedAt: number | null; // from the history
  lastActivityAt: number | null; // latest of the record's lastActivityAt and the app-observed count change
  firstSeenAt: number; // the app's first sighting of the thread in this mount
}): number {
  const { turnEndedAt, lastActivityAt, firstSeenAt } = input;
  if (turnEndedAt === null && lastActivityAt === null) return firstSeenAt;
  if (turnEndedAt === null) return lastActivityAt as number;
  if (lastActivityAt === null) return turnEndedAt;
  return Math.max(turnEndedAt, lastActivityAt);
}

export function isSilentPastThreshold(origin: number, now: number, thresholdMinutes: number): boolean {
  return now - origin > thresholdMinutes * 60_000;
}

export function validateSilenceThreshold(
  raw: string,
): { ok: true; minutes: number } | { ok: false; reason: string } {
  if (!/^\d+$/.test(raw)) {
    return { ok: false, reason: "Enter a whole number of minutes." };
  }
  const minutes = Number(raw);
  if (minutes < SILENCE_THRESHOLD_MIN_MINUTES || minutes > SILENCE_THRESHOLD_MAX_MINUTES) {
    return {
      ok: false,
      reason: `Enter a number between ${SILENCE_THRESHOLD_MIN_MINUTES} and ${SILENCE_THRESHOLD_MAX_MINUTES}.`,
    };
  }
  return { ok: true, minutes };
}

export function backgroundSignature(work: BackgroundWork): string {
  return `${work.workers}:${work.commands}:${work.workflows}`;
}
