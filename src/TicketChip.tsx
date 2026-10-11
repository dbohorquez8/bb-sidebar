import type { TicketMatch } from "./attention";

/** The ticket id before a card's title, when a confident id was found. */
export function TicketChip({ ticket }: { ticket: TicketMatch }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1 font-mono text-2xs text-muted-foreground">
      {ticket.id}
    </span>
  );
}
