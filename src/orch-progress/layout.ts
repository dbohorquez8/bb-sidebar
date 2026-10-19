import { chipText, numberChipsUnambiguous, type TicketKind } from "./state";

/** How one ticket is drawn: its full id, its number, or a bare tick. All three share one height. */
export type TicketForm = "full" | "number" | "tick";

const CHAR_PX = 6.4;
const CHIP_PAD_PX = 8;
/** Gap between neighbouring items; the same in every form, so it never changes the budget. */
export const ITEM_GAP_PX = 2;
/** Narrowest a tick can render; the budget starts every ticket at this width. */
export const TICK_MIN_PX = 2;
const COUNT_CHAR_PX = 5.8;
/** Space between the ticket list and the count. */
export const COUNT_GAP_PX = 6;

export type LayoutTicket = { id: string; kind: TicketKind; attention: boolean };

export type RowLayout = { forms: TicketForm[]; showCount: boolean };

export function countWidth(counts: { done: number; total: number }): number {
  return `${counts.done} / ${counts.total}`.length * COUNT_CHAR_PX + COUNT_GAP_PX;
}

function formWidth(id: string, form: TicketForm, numeric: boolean): number {
  return form === "tick" ? TICK_MIN_PX : chipText(id, form, numeric).length * CHAR_PX + CHIP_PAD_PX;
}

/** Without a measurement (first paint, no layout engine) every ticket takes the form that list length allows. */
export function fallbackForm(total: number): TicketForm {
  return total <= 4 ? "full" : total <= 12 ? "number" : "tick";
}

/**
 * Upgrade order: In Progress and any ticket carrying an attention note, then In Review, then Ready in
 * ledger order, then Done newest first so the oldest Done tickets stay compact longest. Ties keep ledger order.
 */
export function upgradeOrder(tickets: readonly LayoutTicket[]): number[] {
  const tier = (t: LayoutTicket) => (t.kind === "in-progress" || t.attention ? 0 : t.kind === "in-review" ? 1 : t.kind === "ready" ? 2 : 3);
  return tickets
    .map((t, index) => ({ index, tier: tier(t) }))
    .sort((a, b) => a.tier - b.tier || (a.tier === 3 ? b.index - a.index : a.index - b.index))
    .map((entry) => entry.index);
}

/**
 * Greedy per-ticket form choice. `available` is the row width left after the epic chip; the count is
 * reserved first and dropped only when even an all-tick list does not fit beside it. Every ticket starts
 * as a tick, then tickets are upgraded in priority order to a full chip, else a number chip, else left
 * a tick (a smaller upgrade later may still fit). A pure function of its inputs, so a refresh with
 * unchanged data returns the same forms; display order stays ledger order.
 */
export function chooseTicketForms(
  tickets: readonly LayoutTicket[],
  available: number | null,
  counts: { done: number; total: number },
): RowLayout {
  const n = tickets.length;
  if (available === null || n === 0) return { forms: tickets.map(() => fallbackForm(n)), showCount: true };
  const base = n * TICK_MIN_PX + (n - 1) * ITEM_GAP_PX;
  const showCount = base + countWidth(counts) <= available;
  let remaining = available - (showCount ? countWidth(counts) : 0) - base;
  const forms: TicketForm[] = tickets.map(() => "tick");
  const numeric = numberChipsUnambiguous(tickets.map((t) => t.id));
  for (const index of upgradeOrder(tickets)) {
    const id = tickets[index]!.id;
    for (const form of ["full", "number"] as const) {
      const extra = formWidth(id, form, numeric) - TICK_MIN_PX;
      if (extra <= remaining) {
        forms[index] = form;
        remaining -= extra;
        break;
      }
    }
  }
  return { forms, showCount };
}

/** One word for the whole row: a single form when all tickets share it, else "mixed". */
export function rowMode(forms: readonly TicketForm[]): TicketForm | "mixed" {
  const first = forms[0];
  return first !== undefined && forms.every((f) => f === first) ? first : "mixed";
}
