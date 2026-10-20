import type { OrchGroupEntry, OrchTicket } from "./contract";

/** A readable group with at least one ticket is what the card renders. */
export type OrchGroupModel = Extract<OrchGroupEntry, { readable: true }>;

/** The tracker statuses a ticket can show (ready, in progress, in review, done); a ticket is colored by one of these and nothing else. */
export type TicketKind = "ready" | "in-progress" | "in-review" | "done";

export const KIND_WORD: Record<TicketKind, string> = {
  ready: "Ready",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
};

/** CSS custom property each chip is filled with; null means the neutral muted chip. */
export const KIND_FILL: Record<TicketKind, string | null> = {
  ready: null,
  "in-progress": "--bb-sidebar-pill-progress-working",
  "in-review": "--bb-sidebar-pill-progress-merging",
  done: "--bb-sidebar-pill-background",
};

/** Status text tone each chip uses on its pill tint; null means the muted foreground. */
export const KIND_TEXT: Record<TicketKind, string | null> = {
  ready: null,
  "in-progress": "--ws-blue-text",
  "in-review": "--ws-violet-text",
  done: "--ws-green-text",
};

/** Draw order for the summary; the same four statuses, never an attention color. */
export const KIND_RUN_ORDER: readonly TicketKind[] = ["in-progress", "in-review", "ready", "done"];

const WORKING_PHASES = new Set(["starting", "started", "running"]);
const STALL_NOTES: Record<string, string> = {
  usage: "stalled: waiting on usage",
  go: "stalled: waiting on go",
  "waiting-ci": "stalled: waiting on CI",
  idle: "stalled: idle",
  contract: "failed: contract",
  denied: "failed: denied",
  hung: "failed: hung",
  error: "failed: error",
};

export type TicketStatus = { kind: TicketKind; note: string | null; needsYou: boolean };

/** Status is the tracker status alone; attention (questions, stalls, failures) is a note beside it (plan 3.5). */
export function ticketStatus(t: OrchTicket): TicketStatus {
  const { phase, stopKind } = t;
  const needsYou = t.hasQuestion || (phase === "stopped" && stopKind === "decision");
  const note = (kind: TicketKind, text: string | null): TicketStatus => ({
    kind, needsYou, note: needsYou ? "needs you" : text,
  });
  if (t.hasQuestion) return note("in-progress", null);
  if (t.verification === "verified-done") return note("done", null);
  if (phase === null) return note("ready", null);
  if (phase === "merging") return note("in-review", null);
  if (WORKING_PHASES.has(phase)) return note("in-progress", null);
  if (phase === "waiting-usage") return note("in-progress", STALL_NOTES.usage!);
  if (phase === "setup-failed") return note("ready", "setup failed");
  if (phase === "start-failed") return note("ready", "start failed");
  if (phase === "stopped" && stopKind !== null) {
    if (stopKind === "decision") return note("in-progress", null);
    const text = STALL_NOTES[stopKind];
    if (text !== undefined) return note("in-progress", text);
  }
  return note("ready", null);
}

export function ticketKind(t: OrchTicket): TicketKind {
  return ticketStatus(t).kind;
}

export type TicketView = { id: string; kind: TicketKind; word: string; note: string | null; needsYou: boolean; label: string; threadId: string | null };

/** One row per ticket in ledger order, for the hover list. `label` is the status word plus its note. */
export function ticketViews(group: Pick<OrchGroupModel, "tickets">): TicketView[] {
  return group.tickets.map((t) => {
    const { kind, note, needsYou } = ticketStatus(t);
    const word = KIND_WORD[kind];
    return { id: t.id, kind, word, note, needsYou, label: note === null ? word : `${word} · ${note}`, threadId: t.threadId };
  });
}

export type ProgressCounts = { total: number; done: number; needsYou: number; kinds: Record<TicketKind, number> };

export function progressCounts(group: Pick<OrchGroupModel, "tickets">): ProgressCounts {
  const kinds: Record<TicketKind, number> = { ready: 0, "in-progress": 0, "in-review": 0, done: 0 };
  let needsYou = 0;
  for (const t of group.tickets) {
    const s = ticketStatus(t);
    kinds[s.kind] += 1;
    if (s.needsYou) needsYou += 1;
  }
  return { total: group.tickets.length, done: kinds.done, needsYou, kinds };
}

const SUMMARY_PHRASE: Record<Exclude<TicketKind, "done">, string> = {
  "in-progress": "in progress",
  "in-review": "in review",
  ready: "ready",
};

export function tooltipSummary(counts: ProgressCounts): string {
  let text = `${counts.done} of ${counts.total} done`;
  for (const kind of KIND_RUN_ORDER) {
    if (kind !== "done" && counts.kinds[kind] > 0) text += ` · ${counts.kinds[kind]} ${SUMMARY_PHRASE[kind]}`;
  }
  if (counts.needsYou > 0) text += ` · ${counts.needsYou} need you`;
  return text;
}

export type OrchLabelModel = { kind: "epic" | "code"; text: string };

/**
 * Text of the strip's first tick: the epic id as recorded, else the project code (the ticket-id prefix
 * the tickets share), else nothing when the tickets mix prefixes and no single code names them.
 */
export function orchLabel(group: Pick<OrchGroupModel, "epic" | "tickets">): OrchLabelModel | null {
  if (group.epic !== null) return { kind: "epic", text: group.epic };
  const ids = group.tickets.map((t) => t.id);
  if (ids.length === 0 || !numberChipsUnambiguous(ids)) return null;
  return { kind: "code", text: ID_SHAPE.exec(ids[0]!)![1]! };
}

/** Same height as the ticket chip on an ordinary card (TicketChip is h-[18px]), for the first tick, every ticket tick and the count. */
export const CHIP_HEIGHT_PX = 18;

const ID_SHAPE = /^([A-Za-z]+)-(\d+)$/;

/** Number-only ticks need one shared prefix; otherwise a bare number would be ambiguous. */
export function numberChipsUnambiguous(ids: readonly string[]): boolean {
  const prefixes = new Set<string>();
  for (const id of ids) {
    const m = ID_SHAPE.exec(id);
    if (m === null) return false;
    prefixes.add(m[1]!);
  }
  return prefixes.size <= 1;
}

/** Text a ticket tick shows: its number alone when the prefix is shared, else the full id. */
export function tickText(id: string, numeric: boolean): string {
  return numeric ? ID_SHAPE.exec(id)![2]! : id;
}
