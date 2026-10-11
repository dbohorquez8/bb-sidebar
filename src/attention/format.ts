import type { AttentionStatus, BackgroundWork, BbWord, ResolvedStatus, WashKind } from "./types";

export const STATUS_LABELS: Readonly<Record<Exclude<AttentionStatus, "idle">, string>> = {
  "needs-you": "Needs you",
  check: "Check?",
  failed: "Failed",
  working: "Working",
  background: "Background",
  done: "Done",
};

export const BB_WORD_LABELS: Readonly<Record<BbWord, string>> = {
  draft: "Draft",
  queued: "Queued",
  planning: "Planning",
  goal: "Goal",
};

export function isTimedStatus(status: ResolvedStatus): boolean {
  throw new Error("not implemented");
}

export function formatTimeInStatus(since: number, now: number): string {
  throw new Error("not implemented");
}

export function backgroundWorkCount(work: BackgroundWork): number {
  throw new Error("not implemented");
}

export function washFor(
  status: ResolvedStatus,
  unreadResult: boolean,
  openInThisWindow: boolean,
): WashKind | null {
  throw new Error("not implemented");
}
