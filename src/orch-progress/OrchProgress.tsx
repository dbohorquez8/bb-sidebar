import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "../components/Popover";
import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/utils";
import { EpicGlyph } from "./epic-icon";
import {
  CHIP_HEIGHT_PX,
  numberChipsUnambiguous,
  orchLabel,
  progressCounts,
  ticketViews,
  tickText,
  tooltipSummary,
  type OrchGroupModel,
  type TicketKind,
  type TicketView,
} from "./state";
import { ROW_GAP_PX, chooseChain, type RowLayout } from "./layout";

/**
 * Height, radius, padding and type of the ticket chip on an ordinary card (TicketChip.tsx), which the first
 * tick and every ticket tick copy. A rendered test (AC-35) compares the computed values, so a drift fails.
 */
const TICKET_PILL_CLASS = "flex h-[18px] shrink-0 items-center rounded-full px-1.5 font-mono text-2xs font-medium leading-none";

/** Pill tint and its status text tone per helm status; ready is the neutral muted chip. The same fill in every layout, chained or narrowed. */
const CHIP_CLASS: Record<TicketKind, string> = {
  done: "bg-[color:var(--bb-sidebar-pill-background)] text-[color:var(--ws-green-text)]",
  "in-review": "bg-[color:var(--bb-sidebar-pill-progress-merging)] text-[color:var(--ws-violet-text)]",
  "in-progress": "bg-[color:var(--bb-sidebar-pill-progress-working)] text-[color:var(--ws-blue-text)]",
  ready: "bg-muted text-muted-foreground",
};

/** A narrowed tick (no text) keeps the pastel fill and stays readable through a 1px inset edge in the status tone, which never changes the fill. */
const TICK_EDGE: Record<TicketKind, string> = {
  done: "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ws-green-text)_30%,transparent)]",
  "in-review": "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ws-violet-text)_30%,transparent)]",
  "in-progress": "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ws-blue-text)_30%,transparent)]",
  ready: "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--muted-foreground)_25%,transparent)]",
};

/** Fractional chip widths can add up to a pixel more than the estimate; the budget leaves this much spare. */
const SUBPIXEL_SLACK_PX = 2;

const CHIP_HEIGHT = { height: `${CHIP_HEIGHT_PX}px` };

/** First tick of a grouped card's title row: the epic id (with its glyph), else the project code. */
export function OrchLabel({ group }: { group: OrchGroupModel }) {
  const label = orchLabel(group);
  if (label === null) return null;
  return (
    <span
      data-orch-label={label.kind}
      className={cn(TICKET_PILL_CLASS, "gap-1 bg-muted text-foreground")}
    >
      {label.kind === "epic" ? <EpicGlyph /> : null}
      <span className="[text-box:trim-both_cap_alphabetic]">{label.text}</span>
    </span>
  );
}

/** Compact-card count; the full card renders the same count beside its bar. */
export function OrchCount({ group }: { group: OrchGroupModel }) {
  const { done, total } = progressCounts(group);
  return <span data-testid="orch-progress-count" style={CHIP_HEIGHT} className="flex shrink-0 items-center tabular-nums text-xs leading-none text-muted-foreground"><b>{done}</b> / {total}</span>;
}

function OrchHoverList({ group, onOpenThread }: { group: OrchGroupModel; onOpenThread: (threadId: string) => void }) {
  const { threads } = useSidebarThreads();
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  return (
    <ul aria-label="Orchestrator tickets" className="flex max-h-56 min-w-56 flex-col overflow-y-auto py-1">
      {ticketViews(group).map((ticket) => {
        const thread = ticket.threadId ? threadsById.get(ticket.threadId) : undefined;
        return (
          <li key={ticket.id} className="flex min-w-0 items-center gap-2 px-2 py-1 text-2xs">
            <span className="shrink-0 font-mono text-foreground">{ticket.id}</span>
            <span className="shrink-0 text-muted-foreground">{ticket.label}</span>
            {thread && ticket.threadId ? (
              <button type="button" className="min-w-0 truncate text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => onOpenThread(ticket.threadId!)}>
                {thread.title}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ConnectedOrchHoverList({ group, close }: { group: OrchGroupModel; close: () => void }) {
  const actions = useSidebarThreadActions();
  return <OrchHoverList group={group} onOpenThread={(threadId) => { close(); actions.open(threadId, { split: false }); }} />;
}

function TicketItems({ views, layout }: { views: readonly TicketView[]; layout: RowLayout }) {
  const numeric = numberChipsUnambiguous(views.map((v) => v.id));
  const narrow = layout.mode === "narrow";
  return (
    <>
      {views.map((view) => (
        <span
          key={view.id}
          role="img"
          aria-label={`${view.id}: ${view.label}`}
          data-orch-tick=""
          data-orch-form={layout.mode}
          data-orch-kind={view.kind}
          style={narrow ? { width: `${layout.tickPx}px`, paddingInline: 0 } : undefined}
          className={cn(TICKET_PILL_CLASS, CHIP_CLASS[view.kind], narrow && TICK_EDGE[view.kind])}
        >
          {narrow ? null : <span className="[text-box:trim-both_cap_alphabetic]">{tickText(view.id, numeric)}</span>}
        </span>
      ))}
    </>
  );
}

/**
 * Width the ticket ticks may use, count included: the row minus the first tick and its gap. The strip shrink-wraps
 * its ticks, so its own width cannot be the budget. Null until the first measurement.
 */
function useListRoom(rowRef: RefObject<HTMLElement | null>, firstTick: boolean): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    const measure = () => {
      const width = row.getBoundingClientRect().width;
      if (width <= 0) return;
      const epic = row.querySelector<HTMLElement>("[data-orch-label]");
      const next = Math.floor(width - SUBPIXEL_SLACK_PX - (epic !== null && firstTick ? epic.getBoundingClientRect().width + ROW_GAP_PX : 0));
      setRoom((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [rowRef, firstTick]);
  return room;
}

/** The orchestrator card's title row: first tick (epic id or project code), chained ticket ticks, and the count, with a keyboard-reachable detail list. */
export function OrchTitleRow({ group }: { group: OrchGroupModel }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const views = ticketViews(group);
  const counts = progressCounts(group);
  const summary = tooltipSummary(counts);
  const hasFirstTick = orchLabel(group) !== null;
  const room = useListRoom(rowRef, hasFirstTick);
  const numeric = numberChipsUnambiguous(views.map((v) => v.id));
  const layout = useMemo(
    () => chooseChain(views.map((v) => tickText(v.id, numeric)), room, counts),
    // The layout depends on width and on each ticket's id alone, so a refresh with equal data keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, counts.done, counts.total, views.map((v) => v.id).join(",")],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={summary} side="bottom">
        <PopoverTrigger asChild>
          <button
            ref={rowRef}
            type="button"
            title={summary}
            aria-label={`Orchestrator progress: ${summary}`}
            data-testid="orch-title-row"
            data-orch-mode={layout.mode}
            style={CHIP_HEIGHT}
            className="pointer-events-auto relative z-10 flex w-full min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {hasFirstTick ? <span className="flex shrink-0"><OrchLabel group={group} /></span> : null}
            <span data-testid="orch-ticket-list" style={{ ...CHIP_HEIGHT, columnGap: `${layout.gap}px` }} className="flex min-w-0 items-center overflow-hidden">
              <TicketItems views={views} layout={layout} />
            </span>
            {layout.showCount ? <OrchCount group={group} /> : null}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent role="region" aria-label="Orchestrator ticket details" align="start" side="bottom" sideOffset={6} className="w-auto p-0">
        <ConnectedOrchHoverList group={group} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
