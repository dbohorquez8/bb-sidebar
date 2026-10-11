import type { ReactNode } from "react";

/**
 * The shelf above every other shelf: every thread needing the owner, across
 * every project and lifecycle shelf (snoozed, parked, settled), longest
 * waiting first. Absent entirely at zero, and never collapsible — a thread
 * that needs you is not something to fold away.
 */
export function NeedsYouShelf({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section aria-label="Needs you">
      <h2 className="flex items-center gap-2 px-2.5 pb-1 pt-3">
        <span className="text-2xs font-medium text-[color:var(--bb-sidebar-status-needs-you)]">
          Needs you · {count}
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
      </h2>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}
