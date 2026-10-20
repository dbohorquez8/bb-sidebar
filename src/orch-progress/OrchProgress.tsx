import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  orchLabel,
  progressCounts,
  ticketViews,
  tooltipSummary,
  type OrchGroupModel,
  type TicketKind,
} from "./state";
import { BAR_HEIGHT_PX, GROUP_MAX_SHARE, SEGMENT_GAP_PX, barNaturalPx, segmentLayout } from "./layout";

/** Height, radius, padding and type of the ticket chip on an ordinary card (TicketChip.tsx), which the epic or project-code chip copies. A rendered test compares the computed values, so a drift fails. */
const CHIP_CLASS = "flex h-[18px] shrink-0 whitespace-nowrap items-center gap-1 rounded-full bg-muted px-1.5 font-mono text-2xs font-medium leading-none text-foreground";

/** Segment fill per status: pastel solid tokens (hue of the bright helm token, fixed lightness and low chroma, set per theme in theme.css), no transparency, no text; ready is a quiet track tone like helm's empty segments. */
const SEGMENT_CLASS: Record<TicketKind, string> = {
  done: "bg-[color:var(--bb-sidebar-pill-progress-done)]",
  "in-review": "bg-[color:var(--bb-sidebar-pill-progress-merging)]",
  "in-progress": "bg-[color:var(--bb-sidebar-pill-progress-working)]",
  ready: "bg-[color:color-mix(in_oklab,var(--foreground)_18%,transparent)]",
};

const CHIP_HEIGHT = { height: `${CHIP_HEIGHT_PX}px` };

/** The epic id (with its glyph), else the project code. */
export function OrchLabel({ group }: { group: OrchGroupModel }) {
  const label = orchLabel(group);
  if (label === null) return null;
  return (
    <span data-orch-label={label.kind} className={CHIP_CLASS}>
      {label.kind === "epic" ? <EpicGlyph /> : null}
      <span className="[text-box:trim-both_cap_alphabetic]">{label.text}</span>
    </span>
  );
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

/** Only the bar's two outer ends are rounded, fully; every inner joint is square. */
function endRounding(isFirst: boolean, isLast: boolean): string {
  return cn(isFirst ? "rounded-l-full" : "rounded-l-none", isLast ? "rounded-r-full" : "rounded-r-none");
}

/**
 * The slim bar: one text-free segment per ticket. Its width follows the ticket count, is capped by its group's
 * share of the card, and shrinks when the card is narrow (the thread title shrinks first). The wrapper is measured,
 * and `segmentLayout` gives every segment a whole-pixel width and every joint the same whole-pixel gap, so no gap
 * looks wider than another. Until the first measurement the segments share the room evenly with a 2px gap.
 */
function OrchBar({ views }: { views: ReturnType<typeof ticketViews> }) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = wrapper.current;
    if (!node) return;
    const measure = () => setWidth(Math.floor(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const layout = width === null ? null : segmentLayout(width, views.length);
  return (
    <span ref={wrapper} aria-hidden="true" style={{ height: `${BAR_HEIGHT_PX}px` }} className="block min-w-0">
      <span
        data-testid="orch-bar"
        style={{ height: `${BAR_HEIGHT_PX}px`, columnGap: `${layout ? layout.gap : SEGMENT_GAP_PX}px` }}
        className="flex items-center"
      >
        {views.map((view, index) => (
          <span
            key={view.id}
            data-orch-tick=""
            data-orch-kind={view.kind}
            style={layout ? { width: `${layout.widths[index]}px` } : undefined}
            className={cn("h-full min-w-0", layout ? "shrink-0" : "flex-1", SEGMENT_CLASS[view.kind], endRounding(index === 0, index === views.length - 1))}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * The orchestrator card's title line: the chip, then the thread title (`children`, which takes the room first and
 * truncates), then the bar and done / total count as one right-aligned group capped at `GROUP_MAX_SHARE` of the
 * line. The group opens a keyboard-reachable ticket detail list and carries the one summary tooltip.
 */
export function OrchTitleRow({ group, children }: { group: OrchGroupModel; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const views = ticketViews(group);
  const counts = progressCounts(group);
  const summary = tooltipSummary(counts);
  // A grid, so the group's width runs from nothing up to the bar's natural width and the cap or a narrow card can shrink it.
  const columns = `minmax(0, ${barNaturalPx(views.length)}px) auto`;
  return (
    <>
      <OrchLabel group={group} />
      {children}
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip label={summary} side="bottom">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Orchestrator progress: ${summary}`}
              data-testid="orch-title-row"
              style={{ ...CHIP_HEIGHT, gridTemplateColumns: columns, maxWidth: `${GROUP_MAX_SHARE * 100}%` }}
              className="pointer-events-auto relative z-10 ml-auto grid shrink items-center gap-x-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <OrchBar views={views} />
              <span data-testid="orch-progress-count" className="shrink-0 whitespace-nowrap text-2xs leading-none tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{counts.done}</span>
                {" / "}
                {counts.total}
              </span>
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent role="region" aria-label="Orchestrator ticket details" align="start" side="bottom" sideOffset={6} className="w-auto p-0">
          <ConnectedOrchHoverList group={group} close={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </>
  );
}
