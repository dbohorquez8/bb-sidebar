import type { OrchGroupEntry, OrchTicket } from "./contract";

/** A readable group with at least one ticket is what the card renders. */
export type OrchGroupModel = Extract<OrchGroupEntry, { readable: true }>;

export type TicketKind = "needs-you" | "done" | "merging" | "working" | "stalled" | "failed" | "queued" | "unknown";

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

/** CSS custom property each chip is filled with; null means the neutral muted chip. */
export const KIND_FILL: Record<TicketKind, string | null> = {
  "needs-you": "--bb-sidebar-pill-needs-you",
  done: "--bb-sidebar-pill-background",
  merging: "--bb-sidebar-pill-progress-merging",
  working: "--bb-sidebar-pill-progress-working",
  stalled: "--bb-sidebar-pill-check",
  failed: "--bb-sidebar-pill-needs-you",
  queued: null,
  unknown: null,
};

/** Status text tone each chip uses on its pill tint; null means the muted foreground. */
export const KIND_TEXT: Record<TicketKind, string | null> = {
  "needs-you": "--bb-sidebar-status-needs-you",
  done: "--bb-sidebar-status-background",
  merging: "--ws-violet-text",
  working: "--ws-blue-text",
  stalled: "--bb-sidebar-status-check",
  failed: "--bb-sidebar-status-failed",
  queued: null,
  unknown: null,
};

/** The pill tint mixed stronger, so a filled tick reads against the empty (muted) one. */
export const KIND_TICK: Record<TicketKind, string | null> = {
  "needs-you": "--bb-sidebar-tick-needs-you",
  done: "--bb-sidebar-tick-done",
  merging: "--bb-sidebar-tick-merging",
  working: "--bb-sidebar-tick-working",
  stalled: "--bb-sidebar-tick-check",
  failed: "--bb-sidebar-tick-needs-you",
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
