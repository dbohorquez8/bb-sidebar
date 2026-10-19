import { GalaxyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** The same galaxy glyph helm uses for a recorded epic. */
export function EpicGlyph() {
  return (
    <HugeiconsIcon
      icon={GalaxyIcon}
      className="size-3 shrink-0"
      aria-hidden="true"
      data-testid="orch-epic-icon"
    />
  );
}
