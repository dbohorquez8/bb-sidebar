import type { TicketMatch } from "./attention";

/**
 * The ticket id before a card's title, when a confident id was found.
 *
 * A neutral pill in the same style as the
 * background-work and child-thread chips, so colour on a card stays reserved
 * for status. The project colour lives on the project name instead.
 */
export function TicketChip({ ticket }: { ticket: TicketMatch; projectId?: string }) {
  return (
    <span
      data-ticket-chip=""
      className="flex h-[18px] shrink-0 items-center rounded-full bg-muted px-1.5 font-mono text-2xs font-medium leading-none text-foreground"
    >
      {/* Trimmed to the capitals, so the id sits in the optical middle of the pill. */}
      <span className="[text-box:trim-both_cap_alphabetic]">{ticket.id}</span>
    </span>
  );
}
