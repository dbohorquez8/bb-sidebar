import { relativeTimeLabel } from "../relative-time";
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
  if (status.kind === "idle") return false;
  if (status.kind === "bb-word") return status.word !== "draft" && status.word !== "queued";
  return true;
}

export function formatTimeInStatus(since: number, now: number): string {
  return relativeTimeLabel(since, now);
}

export function backgroundWorkCount(work: BackgroundWork): number {
  return work.workers + work.commands + work.workflows;
}

export function washFor(
  status: ResolvedStatus,
  unreadResult: boolean,
  openInThisWindow: boolean,
): WashKind | null {
  if (openInThisWindow) return null;
  if (status.kind === "needs-you" || status.kind === "check" || status.kind === "failed") {
    return status.kind;
  }
  if (status.kind === "done" && unreadResult) return "done-unread";
  return null;
}
