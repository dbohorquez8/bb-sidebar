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
  done: "--bb-sidebar-status-background",
};

/** The pill tint mixed stronger, so a filled tick reads against the empty (muted) one. */
export const KIND_TICK: Record<TicketKind, string | null> = {
  ready: null,
  "in-progress": "--bb-sidebar-tick-working",
  "in-review": "--bb-sidebar-tick-merging",
  done: "--bb-sidebar-tick-done",
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

/** The epic id as recorded, else no label at all: a plain group shows its tickets only. */
export function orchLabel(group: Pick<OrchGroupModel, "epic">): { kind: "epic"; text: string } | null {
  return group.epic !== null ? { kind: "epic", text: group.epic } : null;
}

export type TicketMode = "full" | "number" | "tick";

/** One height for the epic chip, every ticket chip and every tick, so a mode change never moves the row. */
export const CHIP_HEIGHT_PX = 16;

const CHAR_PX = 6.4;
const CHIP_PAD_PX = 8;
const ITEM_GAP_PX = 2;
const TICK_MIN_PX = 2;
const COUNT_CHAR_PX = 5.8;
const COUNT_GAP_PX = 6;
const ID_SHAPE = /^([A-Za-z]+)-(\d+)$/;

/** Number-only chips need one shared prefix; otherwise a bare number would be ambiguous. */
export function numberChipsUnambiguous(ids: readonly string[]): boolean {
  const prefixes = new Set<string>();
  for (const id of ids) {
    const m = ID_SHAPE.exec(id);
    if (m === null) return false;
    prefixes.add(m[1]!);
  }
  return prefixes.size <= 1;
}

/** Text a chip shows in a mode: the full id, or its numeric part when the prefix is shared. */
export function chipText(id: string, mode: TicketMode, numeric: boolean): string {
  if (mode === "tick") return "";
  if (mode === "number" && numeric) return ID_SHAPE.exec(id)![2]!;
  return id;
}

export function countWidth(counts: Pick<ProgressCounts, "done" | "total">): number {
  return `${counts.done} / ${counts.total}`.length * COUNT_CHAR_PX + COUNT_GAP_PX;
}

function listWidth(ids: readonly string[], mode: TicketMode): number {
  const n = ids.length;
  if (mode === "tick") return n * TICK_MIN_PX + (n - 1) * ITEM_GAP_PX;
  const numeric = numberChipsUnambiguous(ids);
  return ids.reduce((sum, id) => sum + chipText(id, mode, numeric).length * CHAR_PX + CHIP_PAD_PX, 0) + (n - 1) * ITEM_GAP_PX;
}

/** Without a measurement (first paint, no layout engine) the mode follows list length alone. */
export function fallbackMode(total: number): TicketMode {
  return total <= 4 ? "full" : total <= 12 ? "number" : "tick";
}

export type RowLayout = { mode: TicketMode; showCount: boolean };

/** Widest mode whose list fits the room left of the count; the count shows only if it fits too. */
export function chooseRowLayout(available: number | null, ids: readonly string[], counts: Pick<ProgressCounts, "done" | "total">): RowLayout {
  if (available === null || ids.length === 0) return { mode: fallbackMode(ids.length), showCount: true };
  const modes: TicketMode[] = numberChipsUnambiguous(ids) ? ["full", "number", "tick"] : ["full", "tick"];
  const mode = modes.find((m) => listWidth(ids, m) <= available) ?? "tick";
  return { mode, showCount: listWidth(ids, mode) + countWidth(counts) <= available };
}
