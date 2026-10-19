import { useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  chipText,
  chooseRowLayout,
  numberChipsUnambiguous,
  orchLabel,
  progressCounts,
  ticketViews,
  tooltipSummary,
  type OrchGroupModel,
  type TicketKind,
  type TicketView,
} from "./state";

/** Pill tint and its status text tone per helm status; ready is the neutral muted chip. */
const CHIP_CLASS: Record<TicketKind, string> = {
  done: "bg-[color:var(--bb-sidebar-pill-background)] text-[color:var(--bb-sidebar-status-background)]",
  "in-review": "bg-[color:var(--bb-sidebar-pill-progress-merging)] text-[color:var(--ws-violet-text)]",
  "in-progress": "bg-[color:var(--bb-sidebar-pill-progress-working)] text-[color:var(--ws-blue-text)]",
  ready: "bg-muted text-muted-foreground",
};

/** The same tints mixed stronger, so a done tick reads against a ready one. */
const TICK_CLASS: Record<TicketKind, string> = {
  done: "bg-[color:var(--bb-sidebar-tick-done)]",
  "in-review": "bg-[color:var(--bb-sidebar-tick-merging)]",
  "in-progress": "bg-[color:var(--bb-sidebar-tick-working)]",
  ready: "bg-muted",
};

const CHIP_HEIGHT = { height: `${CHIP_HEIGHT_PX}px` };

/** Epic chip that leads a grouped card's title row; a plain ticket group has no label. */
export function OrchLabel({ group }: { group: OrchGroupModel }) {
  const label = orchLabel(group);
  if (label === null) return null;
  return (
    <span
      data-orch-label={label.kind}
      style={CHIP_HEIGHT}
      className="flex shrink-0 items-center gap-1 bg-muted px-1.5 font-mono text-[10px] font-medium leading-none text-foreground"
    >
      <EpicGlyph />
      <span className="[text-box:trim-both_cap_alphabetic]">{label.text}</span>
    </span>
  );
}

/** Compact-card count; the full card renders the same count beside its bar. */
export function OrchCount({ group }: { group: OrchGroupModel }) {
  const { done, total } = progressCounts(group);
  return <span data-testid="orch-progress-count" className="shrink-0 tabular-nums text-2xs text-muted-foreground"><b>{done}</b> / {total}</span>;
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

function TicketItems({ views, mode }: { views: readonly TicketView[]; mode: "full" | "number" | "tick" }) {
  const numeric = numberChipsUnambiguous(views.map((v) => v.id));
  return (
    <>
      {views.map((view) =>
        mode === "tick" ? (
          <span
            key={view.id}
            role="img"
            aria-label={`${view.id}: ${view.label}`}
            data-orch-tick=""
            data-orch-kind={view.kind}
            style={CHIP_HEIGHT}
            className={cn("min-w-[2px] max-w-2 flex-1 basis-0", TICK_CLASS[view.kind])}
          />
        ) : (
          <span
            key={view.id}
            role="img"
            aria-label={`${view.id}: ${view.label}`}
            data-orch-chip=""
            data-orch-kind={view.kind}
            style={CHIP_HEIGHT}
            className={cn("flex shrink-0 items-center px-1 font-mono text-[10px] font-medium leading-none tabular-nums", CHIP_CLASS[view.kind])}
          >
            {chipText(view.id, mode, numeric)}
          </span>
        ),
      )}
    </>
  );
}

/** Row width the layout is chosen from; null until the first measurement, never derived from the row's own output. */
function useRowRoom(rowRef: RefObject<HTMLElement | null>, epicRef: RefObject<HTMLElement | null>): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    const measure = () => {
      const width = row.getBoundingClientRect().width;
      if (width <= 0) return;
      const epic = epicRef.current?.getBoundingClientRect().width ?? 0;
      const next = Math.floor(width - (epic > 0 ? epic + 6 : 0));
      setRoom((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [rowRef, epicRef]);
  return room;
}

/** The orchestrator card's title row: epic chip, per-ticket chips or ticks, and the count, with a keyboard-reachable detail list. */
export function OrchTitleRow({ group }: { group: OrchGroupModel }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const epicRef = useRef<HTMLSpanElement>(null);
  const views = ticketViews(group);
  const counts = progressCounts(group);
  const summary = tooltipSummary(counts);
  const room = useRowRoom(rowRef, epicRef);
  const layout = chooseRowLayout(room, views.map((v) => v.id), counts);
  const hasEpic = group.epic !== null;
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
            {hasEpic ? <span ref={epicRef} className="flex shrink-0"><OrchLabel group={group} /></span> : null}
            <span data-testid="orch-ticket-list" className="flex min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
              <TicketItems views={views} mode={layout.mode} />
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
