import type { TicketMatch } from "./types";

export function parseTicketId(
  input: { title: string; branchName: string | null; worktreeName: string | null },
  prefixes: readonly string[],
): TicketMatch | null {
  throw new Error("not implemented");
}

export function stripTicketSeparator(rest: string): string {
  throw new Error("not implemented");
}
