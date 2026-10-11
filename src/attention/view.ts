import {
  backgroundWorkCount,
  BB_WORD_LABELS,
  formatTimeInStatus,
  isTimedStatus,
  STATUS_LABELS,
  washFor,
} from "./format";
import type { AttentionView, BackgroundWork, ResolvedStatus, StageView, TicketMatch } from "./types";

export function buildAttentionView(args: {
  status: ResolvedStatus;
  statusSince: number; // from the stamps
  silenceOrigin: number; // the Check? time counts from here (AC-15)
  unreadResult: boolean;
  openInThisWindow: boolean; // active pane or another pane of this window (AC-21)
  stage: StageView | null;
  ticket: TicketMatch | null;
  background: BackgroundWork;
  ageLabel: string; // today's relativeTimeLabel(thread.updatedAt, now), used for idle
  now: number;
}): AttentionView {
  const { status, statusSince, silenceOrigin, unreadResult, openInThisWindow, stage, ticket, background, ageLabel, now } =
    args;

  const label: string | null =
    status.kind === "idle" ? null : status.kind === "bb-word" ? BB_WORD_LABELS[status.word] : STATUS_LABELS[status.kind];

  const timed = isTimedStatus(status);
  const since = status.kind === "check" ? silenceOrigin : statusSince;
  const timeLabel = timed ? formatTimeInStatus(since, now) : null;

  const wash = washFor(status, unreadResult, openInThisWindow);
  const backgroundCount = backgroundWorkCount(background);

  const accessibleText =
    status.kind === "idle" ? ageLabel : timeLabel !== null ? `${label}, ${timeLabel}` : (label ?? ageLabel);

  return {
    status,
    label,
    timeLabel,
    since: timeLabel !== null ? since : null,
    wash,
    stage,
    ticket,
    background,
    backgroundCount,
    accessibleText,
  };
}
