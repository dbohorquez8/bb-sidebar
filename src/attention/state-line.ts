import type { StateLineMatch, StateMarkerRule } from "./types";

export function matchStateLine(
  text: string | null,
  rules: readonly StateMarkerRule[],
): StateLineMatch | null {
  throw new Error("not implemented");
}
