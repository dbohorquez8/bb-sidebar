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
  throw new Error("not implemented");
}
