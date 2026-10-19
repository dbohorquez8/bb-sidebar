import type { OrchGroupEntry, OrchTicket } from "./contract";

/** A readable group with at least one ticket is what the card renders. */
export type OrchGroupModel = Extract<OrchGroupEntry, { readable: true }>;

export type TicketKind = "needs-you" | "done" | "merging" | "working" | "stalled" | "failed" | "queued" | "unknown";

export const BAR_TICK_LIMIT = 48;
export const MIN_RUN_PX = 4;

export const KIND_WORD: Record<TicketKind, string> = {
  "needs-you": "Needs you",
  done: "Done",
  merging: "Merging",
  working: "Working",
  stalled: "Stalled",
  failed: "Failed",
  queued: "Queued",
  unknown: "Unknown",
};

/** Left-to-right order of the coloured runs; queued and unknown are the bare track. */
export const KIND_RUN_ORDER: Record<TicketKind, number> = {
  done: 0,
  merging: 1,
  working: 2,
  stalled: 3,
  failed: 4,
  "needs-you": 6,
  queued: 7,
  unknown: 7,
};

/** CSS custom property each run is filled with; null means the bare track. */
export const KIND_FILL: Record<TicketKind, string | null> = {
  "needs-you": "--bb-sidebar-status-needs-you",
  done: "--ws-green-text",
  merging: "--ws-violet-text",
  working: "--ws-blue-text",
  stalled: "--bb-sidebar-status-check",
  failed: "--bb-sidebar-status-failed",
  queued: null,
  unknown: null,
};

const WORKING_PHASES = new Set(["starting", "started", "running"]);
const STALLED_STOPS = new Set(["usage", "go", "waiting-ci", "idle"]);
const FAILED_STOPS = new Set(["contract", "denied", "hung", "error"]);

/** First matching row of the state table wins (plan 3.5). */
export function ticketKind(t: OrchTicket): TicketKind {
  if (t.hasQuestion) return "needs-you";
  if (t.verification === "verified-done") return "done";
  const { phase, stopKind } = t;
  if (phase === null) return "queued";
  if (phase === "merging") return "merging";
  if (WORKING_PHASES.has(phase)) return "working";
  if (phase === "waiting-usage") return "stalled";
  if (phase === "setup-failed" || phase === "start-failed") return "failed";
  if (phase === "stopped" && stopKind !== null) {
    if (STALLED_STOPS.has(stopKind)) return "stalled";
    if (stopKind === "decision") return "needs-you";
    if (FAILED_STOPS.has(stopKind)) return "failed";
  }
  return "unknown";
}

export type TicketView = { id: string; kind: TicketKind; word: string; threadId: string | null };

/** One row per ticket in ledger order, for the hover list. */
export function ticketViews(group: Pick<OrchGroupModel, "tickets">): TicketView[] {
  return group.tickets.map((t) => {
    const kind = ticketKind(t);
    return { id: t.id, kind, word: KIND_WORD[kind], threadId: t.threadId };
  });
}

export type ProgressCounts = { total: number; done: number; kinds: Record<TicketKind, number> };

export function progressCounts(group: Pick<OrchGroupModel, "tickets">): ProgressCounts {
  const kinds: Record<TicketKind, number> = {
    "needs-you": 0, done: 0, merging: 0, working: 0, stalled: 0, failed: 0, queued: 0, unknown: 0,
  };
  for (const t of group.tickets) kinds[ticketKind(t)] += 1;
  return { total: group.tickets.length, done: kinds.done, kinds };
}

export type BarRun = { kind: TicketKind; count: number; share: number };

/** Coloured runs in run order; each kind is one run, queued and unknown are left to the bare track. */
export function barRuns(views: readonly TicketView[]): BarRun[] {
  const total = views.length;
  const counts = new Map<TicketKind, number>();
  for (const v of views) if (KIND_FILL[v.kind] !== null) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => KIND_RUN_ORDER[a] - KIND_RUN_ORDER[b])
    .map(([kind, count]) => ({ kind, count, share: count / total }));
}

/** Ticked bar up to the limit, one continuous bar above it. */
export function isTickedBar(total: number): boolean {
  return total <= BAR_TICK_LIMIT;
}

const SUMMARY_ORDER: Array<[TicketKind, string]> = [
  ["needs-you", "needs you"],
  ["failed", "failed"],
  ["stalled", "stalled"],
  ["merging", "merging"],
  ["working", "working"],
];

export function tooltipSummary(counts: ProgressCounts): string {
  let text = `${counts.done} of ${counts.total} done`;
  for (const [kind, phrase] of SUMMARY_ORDER) if (counts.kinds[kind] > 0) text += ` · ${counts.kinds[kind]} ${phrase}`;
  return text;
}

/** The epic id as recorded, else the first ticket id (ledger order) plus "+". */
export function orchLabel(group: Pick<OrchGroupModel, "epic" | "tickets">): { kind: "epic" | "plain"; text: string } {
  if (group.epic !== null) return { kind: "epic", text: group.epic };
  return { kind: "plain", text: group.tickets.length > 0 ? `${group.tickets[0].id}+` : "" };
}
