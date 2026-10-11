import type { StateLineMatch, StateMarkerRule } from "./types";

const VARIATION_SELECTOR_16 = /️/g;

function stripVariationSelector(value: string): string {
  return value.replace(VARIATION_SELECTOR_16, "");
}

export function matchStateLine(
  text: string | null,
  rules: readonly StateMarkerRule[],
): StateLineMatch | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  let best: StateLineMatch | null = null;
  for (const [index, rawLine] of lines.entries()) {
    const normalizedLine = stripVariationSelector(rawLine.replace(/^\s+/, ""));
    let matchedMarkerLength = -1;
    let matchedKind: StateMarkerRule["kind"] | null = null;
    for (const rule of rules) {
      const normalizedMarker = stripVariationSelector(rule.marker);
      if (
        normalizedLine.startsWith(normalizedMarker) &&
        normalizedMarker.length > matchedMarkerLength
      ) {
        matchedMarkerLength = normalizedMarker.length;
        matchedKind = rule.kind;
      }
    }
    if (matchedKind !== null) {
      best = { kind: matchedKind, line: index };
    }
  }
  return best;
}
