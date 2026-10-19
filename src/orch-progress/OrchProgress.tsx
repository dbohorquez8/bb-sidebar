import { useState, type CSSProperties } from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "../components/Popover";
import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/utils";
import { EpicGlyph } from "./epic-icon";
import {
  BAR_TICK_LIMIT,
  KIND_FILL,
  barRuns,
  orchLabel,
  progressCounts,
  ticketViews,
  tooltipSummary,
  type OrchGroupModel,
  type TicketKind,
} from "./state";

const FILL_CLASS: Record<Exclude<TicketKind, "queued" | "unknown">, string> = {
  done: "bg-[color:var(--ws-green)]",
  merging: "bg-[color:var(--ws-violet)]",
  working: "bg-[color:var(--ws-blue)]",
  stalled: "bg-[color:var(--bb-sidebar-status-check)]",
  failed: "bg-[color:var(--bb-sidebar-status-failed)]",
  "needs-you": "bg-[color:var(--bb-sidebar-status-needs-you)]",
};

function tickMask(total: number): CSSProperties {
  const segment = `${100 / total}%`;
  const gap = `min(3px, max(1px, calc(${segment} * 0.28)))`;
  const image = `repeating-linear-gradient(90deg, var(--foreground) 0 calc(${segment} - ${gap}), transparent calc(${segment} - ${gap}) ${segment})`;
  const size = `calc(100% + ${gap}) 100%`;
  return { maskImage: image, WebkitMaskImage: image, maskSize: size, WebkitMaskSize: size };
}

/** Epic or plain-ticket chip that replaces a grouped card's title. */
export function OrchLabel({ group }: { group: OrchGroupModel }) {
  const label = orchLabel(group);
  return (
    <span
      data-orch-label={label.kind}
      className={cn(
        "flex h-[18px] shrink-0 items-center gap-1 px-1.5 font-mono text-2xs font-medium leading-none",
        label.kind === "epic" ? "bg-[color:var(--ws-violet)]/15 text-[color:var(--ws-violet)]" : "bg-muted text-foreground",
      )}
    >
      {label.kind === "epic" ? <EpicGlyph /> : null}
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
            <span className="shrink-0 text-muted-foreground">{ticket.word}</span>
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

/** Segmented ticket-state bar with a keyboard-reachable ledger-order detail list. */
export function OrchProgressRow({ group }: { group: OrchGroupModel }) {
  const [open, setOpen] = useState(false);
  const views = ticketViews(group);
  const counts = progressCounts(group);
  const summary = tooltipSummary(counts);
  const ticked = counts.total > 0 && counts.total <= BAR_TICK_LIMIT;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={summary} side="bottom">
        <PopoverTrigger asChild>
          <button type="button" title={summary} aria-label={`Orchestrator progress: ${summary}`} className="relative z-10 flex w-full min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <span
              data-testid="orch-progress-track"
              className="flex h-1.5 min-w-0 flex-1 overflow-hidden bg-muted"
              style={ticked ? tickMask(counts.total) : undefined}
            >
              {barRuns(views).map((run) => {
                const token = KIND_FILL[run.kind];
                if (token === null) return null;
                const fillClass = FILL_CLASS[run.kind as keyof typeof FILL_CLASS];
                return <span key={run.kind} data-testid="orch-progress-run" data-orch-kind={run.kind} className={cn("min-w-1 shrink", fillClass)} style={{ flexBasis: `${run.share * 100}%` }} />;
              })}
            </span>
            <OrchCount group={group} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent role="region" aria-label="Orchestrator ticket details" align="start" side="bottom" sideOffset={6} className="w-auto p-0">
        <ConnectedOrchHoverList group={group} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
