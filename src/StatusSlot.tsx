import {
  useSidebarThreadDraft,
  type PluginSidebarThread,
  type PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk/app";
import { useContext, useId, useMemo } from "react";
import { isWorkingIndicator } from "./child-status";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { relativeTimeLabel } from "./relative-time";
import { useWorkingSinceContext } from "./useWorkingSince";
import { statusWithDuration } from "./working-since";
import { AttentionContext } from "./useAttention";
import type { AttentionView, ResolvedStatus } from "./attention";

/**
 * The default trailing slot for cards and flat rows: fixed and right-aligned.
 *
 * Fixed rather than intrinsic because both ages and live-status labels vary in
 * width. The slot holds "Planning · 12m" without dragging the project column
 * back and forth as a thread changes state. Child trees override the width:
 * they carry no project column, so there the label's own width wins.
 */
export const STATUS_SLOT_CLASS = "flex w-20 shrink-0 items-center justify-end";

/**
 * The box every trailing glyph sits in, whatever its artwork measures.
 *
 * The status glyph, the provider glyph and a shelf's chevron all end a line at
 * the same inset, but they are drawn at different sizes. A shared box centres
 * each one on the same vertical axis, so right-aligning the boxes lines the
 * icons up instead of leaving them one or two pixels apart.
 */
export const TRAILING_GLYPH_BOX_CLASS =
  "flex size-3.5 shrink-0 items-center justify-center";

/**
 * Status OR age, never both: the glyph already implies the row is current, and
 * the age only earns its place once the thread has nothing to say.
 *
 * A live status carries how long the work has run ("Working · 5m"), so the
 * slot answers "is it stuck?" as well as "what is it doing?".
 */
/** Status word colour, from the attention tokens, or BB's own tone for its own words. */
function attentionLabelClass(status: ResolvedStatus): string {
  switch (status.kind) {
    case "needs-you":
      return "text-[color:var(--bb-sidebar-status-needs-you)]";
    case "check":
      return "text-[color:var(--bb-sidebar-status-check)]";
    case "failed":
      return "text-[color:var(--bb-sidebar-status-failed)]";
    case "working":
      return "text-[color:var(--bb-sidebar-status-working)]";
    case "background":
      return "text-[color:var(--bb-sidebar-status-background)]";
    case "done":
      return "text-[color:var(--bb-sidebar-status-done)]";
    case "bb-word":
      return status.word === "draft" || status.word === "queued"
        ? "text-[color:var(--bb-sidebar-tone-draft)]"
        : "text-[color:var(--bb-sidebar-tone-working)]";
    case "idle":
    default:
      return "text-muted-foreground";
  }
}

export function StatusOrTime({
  thread: listedThread,
  now,
}: {
  thread: PluginSidebarThread;
  /** Quantized clock, shared by every row in one render. */
  now: number;
}) {
  const attention = useContext(AttentionContext);
  const view = attention?.viewFor(listedThread.id) ?? null;
  // Which hooks run must not depend on whether a view exists yet: the
  // attention model can arrive (or a thread's view can disappear) after the
  // first render, and a component may not change which hooks it calls
  // between renders. Delegating to one or the other CHILD component — rather
  // than branching inside this one, before calling the fallback's hooks —
  // keeps every render of this component itself hook-free past this point.
  if (view) {
    return <AttentionStatusOrTime thread={listedThread} view={view} now={now} />;
  }
  return <FallbackStatusOrTime thread={listedThread} now={now} />;
}

function AttentionStatusOrTime({
  thread: listedThread,
  view,
  now,
}: {
  thread: PluginSidebarThread;
  view: AttentionView;
  now: number;
}) {
  const descriptionId = useId();
  if (view.label === null) {
    // Idle: only the age, exactly as today's card does.
    return (
      <span className="tabular-nums text-2xs text-muted-foreground">
        {relativeTimeLabel(listedThread.updatedAt, now)}
      </span>
    );
  }
  // The status slot is one element. Working and Background show an icon, the
  // workflow stage, and the time; Needs you and Done are filled pills with an
  // animated icon; everything else is plain text.
  const kind = view.status.kind;
  const ariaLabel = listedThread.hasPendingInteraction
    ? view.label
    : (listedThread.indicatorLabel ?? view.label);
  const describedBy = view.timeLabel !== null ? descriptionId : undefined;
  const description =
    view.timeLabel !== null ? (
      <span id={descriptionId} className="sr-only">
        {view.accessibleText}
      </span>
    ) : null;
  const time =
    view.timeLabel !== null ? <span className="tabular-nums opacity-80">{view.timeLabel}</span> : null;
  const badge = "inline-flex h-[18px] min-w-0 items-center gap-1 rounded-full px-1.5 text-2xs font-semibold leading-4";

  if (kind === "working" || kind === "background") {
    return (
      <span
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={cn(
          // No fill: only Needs you and an unread Done get a badge.
          "inline-flex h-5 min-w-0 items-center gap-1 text-2xs font-semibold leading-4",
          kind === "working"
            ? "text-[color:var(--bb-sidebar-status-working)]"
            : "text-[color:var(--bb-sidebar-status-background)]",
        )}
      >
        <Icon
          name={kind === "working" ? "Loading" : "Gear"}
          aria-hidden="true"
          className={cn("size-3 shrink-0", kind === "working" ? "animate-spin" : "animate-[spin_4s_linear_infinite]")}
        />
        {/* Outside a workflow the status word stands in for the stage. */}
        <span className="truncate">{view.stage ? view.stage.stageLabel : view.label}</span>
        {view.timeLabel !== null ? (
          <span className="font-normal tabular-nums text-muted-foreground">{view.timeLabel}</span>
        ) : null}
        {description}
      </span>
    );
  }
  if (kind === "needs-you") {
    return (
      <span
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={cn(
          badge,
          "bg-[color:var(--bb-sidebar-pill-needs-you)] text-[color:var(--bb-sidebar-status-needs-you)]",
        )}
      >
        {/* A bell that rings briefly every few seconds, like the spinner and gear beside it. */}
        <Icon name="Bell" aria-hidden="true" className="bb-sidebar-needs-you-bell size-3 shrink-0" />
        <span className="truncate">{view.label}</span>
        {time}
        {description}
      </span>
    );
  }
  if (kind === "done") {
    // A white badge like Needs you, with a check that pops now and then.
    return (
      <span
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={cn(
          badge,
          "bg-[color:var(--bb-sidebar-pill-done-unread)] text-[color:var(--bb-sidebar-status-done-unread)]",
        )}
      >
        <Icon name="CheckCircle" aria-hidden="true" className="bb-sidebar-done-check size-3 shrink-0" />
        <span className="truncate">{view.label}</span>
        {time}
        {description}
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 min-w-0 items-center gap-1 text-2xs leading-4">
      <span
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={cn("max-w-full truncate font-medium", attentionLabelClass(view.status))}
      >
        {view.label}
      </span>
      {view.timeLabel !== null ? (
        <span className="tabular-nums text-muted-foreground">{view.timeLabel}</span>
      ) : null}
      {description}
    </span>
  );
}

function FallbackStatusOrTime({
  thread: listedThread,
  now,
}: {
  thread: PluginSidebarThread;
  now: number;
}) {
  const thread = useThreadWithDraft(listedThread);
  const workingSince = useWorkingSinceContext();
  const status = threadShortStatus(thread);
  if (status !== null) {
    const label = shortStatusLabel(status, workingSince.get(thread.id), now);
    return (
      <span
        aria-label={
          status.ariaLabel ??
          (thread.hasPendingInteraction ? label : (thread.indicatorLabel ?? label))
        }
        className={cn(
          "max-w-full truncate text-2xs font-medium",
          status.showsDuration && "tabular-nums",
          status.className,
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <span className="tabular-nums text-2xs text-muted-foreground">
      {relativeTimeLabel(thread.updatedAt, now)}
    </span>
  );
}

/**
 * Folds an unsent composer draft into bb's indicator the way bb's own row
 * does. bb leaves drafts out of `indicator` because they are per-client, so a
 * busy thread with a draft becomes "working-draft" and an otherwise quiet one
 * "draft". A failure, a raised hand, an unread result or a queued message
 * keeps its own status.
 */
export function withDraftIndicator(
  indicator: PluginSidebarThreadIndicator,
  hasDraft: boolean,
): PluginSidebarThreadIndicator {
  if (!hasDraft) return indicator;
  if (isWorkingIndicator(indicator)) return "working-draft";
  return indicator === "none" ? "draft" : indicator;
}

/** The thread as its row should draw it, with this client's draft folded in. */
export function useThreadWithDraft(
  thread: PluginSidebarThread,
): PluginSidebarThread {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const indicator = withDraftIndicator(thread.indicator, hasUnsubmittedDraft);
  return useMemo(
    () =>
      indicator === thread.indicator
        ? thread
        : {
            ...thread,
            indicator,
            // bb's own wording for the two draft glyphs.
            indicatorLabel:
              indicator === "draft"
                ? "Thread has unsubmitted draft"
                : "Thread working with unsubmitted draft",
          },
    [thread, indicator],
  );
}

export interface ShortStatus {
  label: string;
  className: string;
  /** Live work gets a running duration; a verdict or a request does not. */
  showsDuration: boolean;
  /** For statuses bb has no indicator for, so no accessible label either. */
  ariaLabel?: string;
}

export function shortStatus(
  indicator: PluginSidebarThreadIndicator,
  indicatorLabel: string | null,
): ShortStatus | null {
  const className = statusToneClass(indicator);
  switch (indicator) {
    case "unread-error":
      return { label: "Failed", className, showsDuration: false };
    case "waiting-for-input":
      return { label: "Needs you", className, showsDuration: false };
    case "unread-success":
      return { label: "Unread", className, showsDuration: false };
    case "runtime":
      return {
        label: isMonitoringLabel(indicatorLabel) ? "Monitoring" : "Working",
        className,
        showsDuration: true,
      };
    case "workflow":
      return { label: "Workflow", className, showsDuration: true };
    case "background-agent":
      return { label: "Agent", className, showsDuration: true };
    case "background-command":
      return { label: "Command", className, showsDuration: true };
    case "plan-mode":
      return { label: "Planning", className, showsDuration: true };
    case "goal":
      return { label: "Goal", className, showsDuration: true };
    case "draft":
      return { label: "Draft", className, showsDuration: false };
    case "working-draft":
      return { label: "Drafting", className, showsDuration: true };
    case "none":
      return null;
    default:
      return null;
  }
}

/**
 * A pending user interaction outranks any concurrently reported runtime, and a
 * message that failed to send outranks the rest: bb paints no indicator for
 * either queued state, so a row would otherwise look idle or merely busy.
 * A waiting message only shows on an otherwise quiet row; a running turn
 * already says more.
 */
export function threadShortStatus(
  thread: PluginSidebarThread,
): ShortStatus | null {
  if (thread.hasPendingInteraction) {
    return shortStatus("waiting-for-input", null);
  }
  if (thread.queuedWork === "failed") {
    return {
      label: "Send failed",
      className: statusToneClass("unread-error"),
      showsDuration: false,
      ariaLabel: "A queued message failed to send",
    };
  }
  const status = shortStatus(thread.indicator, thread.indicatorLabel);
  if (status === null && thread.queuedWork === "waiting") {
    return {
      label: "Queued",
      className: statusToneClass("draft"),
      showsDuration: false,
      ariaLabel: "A message is waiting to send",
    };
  }
  return status;
}

export function shortStatusLabel(
  status: ShortStatus,
  startedAt: number | undefined,
  now: number,
): string {
  return status.showsDuration
    ? statusWithDuration(status.label, startedAt, now)
    : status.label;
}

export function threadStatusLabel(
  thread: PluginSidebarThread,
  startedAt: number | undefined,
  now: number,
): string | null {
  const status = threadShortStatus(thread);
  return status === null ? null : shortStatusLabel(status, startedAt, now);
}

/**
 * A monitor is still a runtime, so the indicator keeps the usual spinner and
 * working duration. BB's accessible label carries the more precise state.
 */
function isMonitoringLabel(label: string | null): boolean {
  return label?.toLocaleLowerCase().includes("monitoring") ?? false;
}

/** Status palette shared by cards, child labels, and glyphs. */
export function statusToneClass(
  indicator: PluginSidebarThreadIndicator,
): string {
  switch (indicator) {
    case "unread-error":
      return "text-[color:var(--bb-sidebar-tone-error)]";
    case "waiting-for-input":
      return "text-[color:var(--bb-sidebar-tone-pending)]";
    case "unread-success":
      return "text-[color:var(--bb-sidebar-tone-success)]";
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
      return "text-[color:var(--bb-sidebar-tone-working)]";
    case "draft":
    case "working-draft":
      return "text-[color:var(--bb-sidebar-tone-draft)]";
    case "none":
    default:
      return "text-muted-foreground";
  }
}
