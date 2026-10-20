import { useState, type ReactNode } from "react";
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
import { BAR_HEIGHT_PX, GROUP_MAX_SHARE, barGapCss, barNaturalPx } from "./layout";

/** Height, radius, padding and type of the ticket chip on an ordinary card (TicketChip.tsx), which the epic or project-code chip copies. A rendered test compares the computed values, so a drift fails. */
const CHIP_CLASS = "flex h-[18px] shrink-0 whitespace-nowrap items-center gap-1 rounded-full bg-muted px-1.5 font-mono text-2xs font-medium leading-none text-foreground";

/** Segment fill per status: helm's status colors, slightly muted (82% of the color, the rest is the card showing through, so the hue stays and the intensity drops), no text; ready is a quiet track tone like helm's empty segments. */
const SEGMENT_CLASS: Record<TicketKind, string> = {
  done: "bg-[color:color-mix(in_oklab,var(--ws-green)_82%,transparent)]",
  "in-review": "bg-[color:color-mix(in_oklab,var(--bb-sidebar-pill-progress-merging)_82%,transparent)]",
  "in-progress": "bg-[color:color-mix(in_oklab,var(--bb-sidebar-pill-progress-working)_82%,transparent)]",
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
 * share of the card, and shrinks when the card is narrow (the thread title shrinks first). The wrapper is a size
 * container so the gap can close, in CSS, once the segments reach their floor.
 */
function OrchBar({ views }: { views: ReturnType<typeof ticketViews> }) {
  return (
    <span aria-hidden="true" style={{ height: `${BAR_HEIGHT_PX}px`, containerType: "inline-size" }} className="block min-w-0">
      <span
        data-testid="orch-bar"
        style={{ height: `${BAR_HEIGHT_PX}px`, columnGap: barGapCss(views.length) }}
        className="flex w-full items-center"
      >
        {views.map((view, index) => (
          <span
            key={view.id}
            data-orch-tick=""
            data-orch-kind={view.kind}
            className={cn("h-full min-w-0 flex-1", SEGMENT_CLASS[view.kind], endRounding(index === 0, index === views.length - 1))}
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
