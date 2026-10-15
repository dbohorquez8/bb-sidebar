import {
  backgroundWorkCount,
  BB_WORD_LABELS,
  formatTimeInStatus,
  isTimedStatus,
  STATUS_LABELS,
} from "./format";
import { LABEL_TONES } from "./rules";
import type { AttentionView, BackgroundWork, ObservedRules, ResolvedStatus, RuleLabelView, SliceProgress, TicketMatch } from "./types";

/** Design-system token behind each label tone; `primary` reads the host token. */
export const LABEL_TONE_COLOURS: Readonly<Record<(typeof LABEL_TONES)[number], string>> = {
  muted: "var(--ws-gray-text)",
  primary: "var(--primary)",
  success: "var(--ws-green-text)",
  warning: "var(--ws-orange-text)",
  danger: "var(--ws-red-text)",
};

/** The label as shown on the card: "Building", or "Building 2/5" with slice progress. */
export function ruleLabelText(label: RuleLabelView): string {
  return label.sliceProgress ? `${label.text} ${label.sliceProgress.done}/${label.sliceProgress.total}` : label.text;
}

/** The rule label with the thread's finished/total slices attached when the label asks for them. */
export function ruleLabelView(
  label: ObservedRules["label"] | undefined,
  slices: SliceProgress | undefined,
): RuleLabelView | null {
  if (!label) return null;
  return label.progress === "slices" && slices && slices.total >= 1
    ? { ...label, sliceProgress: { done: Math.min(slices.done.length, slices.total), total: slices.total } }
    : label;
}

export function buildAttentionView(args: {
  status: ResolvedStatus;
  statusSince: number; // from the stamps
  silenceOrigin: number; // the Check? time counts from here (AC-15)
  ruleLabel?: RuleLabelView | null;
  ticket: TicketMatch | null;
  background: BackgroundWork;
  ageLabel: string; // today's relativeTimeLabel(thread.updatedAt, now), used for idle
  now: number;
}): AttentionView {
  const { status, statusSince, silenceOrigin, ruleLabel = null, ticket, background, ageLabel, now } =
    args;

  const label: string | null =
    status.kind === "idle" ? null : status.kind === "bb-word" ? BB_WORD_LABELS[status.word] : STATUS_LABELS[status.kind];

  const timed = isTimedStatus(status);
  const since = status.kind === "check" ? silenceOrigin : statusSince;
  const timeLabel = timed ? formatTimeInStatus(since, now) : null;

  const backgroundCount = backgroundWorkCount(background);

  const accessibleText =
    status.kind === "idle" ? ageLabel : timeLabel !== null ? `${label}, ${timeLabel}` : (label ?? ageLabel);

  return {
    status,
    label,
    timeLabel,
    since: timeLabel !== null ? since : null,
    ruleLabel,
    ticket,
    background,
    backgroundCount,
    accessibleText,
  };
}
