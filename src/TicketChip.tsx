import type { TicketMatch } from "./attention";
import { chipTextColor } from "./project-colors";
import { useProjectColorValue } from "./ProjectColors";

/**
 * The ticket id before a card's title, when a confident id was found. It is
 * filled with the thread's project colour; the text is near-black or white,
 * whichever contrasts more with that fill. The text box is trimmed to
 * the capital letters, so the padding above and below the id is even.
 */
export function TicketChip({ ticket, projectId }: { ticket: TicketMatch; projectId?: string }) {
  const fill = useProjectColorValue(projectId);
  const text = fill ? chipTextColor(fill) : null;
  return (
    <span
      data-ticket-chip=""
      className={
        "shrink-0 rounded-sm px-1 py-1 font-mono text-2xs font-medium leading-none [text-box:trim-both_cap_alphabetic]" +
        (text ? "" : " bg-foreground/10 text-foreground/80")
      }
      style={text ? { backgroundColor: fill, color: text } : undefined}
    >
      {ticket.id}
    </span>
  );
}
