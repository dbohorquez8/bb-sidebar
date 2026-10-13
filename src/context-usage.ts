/** Realtime channel carrying `{ threadId, percent }` when a thread's context fill moves. */
export const CONTEXT_USAGE_CHANNEL = "context-usage";

/** The context-ring plugin's id; its `softLimit` setting is the one source of the limit. */
export const CONTEXT_RING_PLUGIN_ID = "context-ring";

/** Used when context-ring is absent or its `softLimit` is blank or unparseable. Matches the ring's own default. */
export const DEFAULT_CONTEXT_SOFT_LIMIT = 150_000;

/**
 * Parses context-ring's `softLimit` text: "150000", "150k", "150 K", "1.5m".
 * Returns null for anything else. Mirrors the ring's own parser so both agree.
 */
export function parseSoftLimit(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase().replace(/[_,\s]/g, "");
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(text);
  if (!match) return null;
  const scale = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const value = Math.round(Number(match[1]) * scale);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The soft limit from context-ring's stored setting values, or the default. */
export function resolveContextSoftLimit(values: Record<string, unknown> | null | undefined): number {
  return parseSoftLimit(values?.softLimit) ?? DEFAULT_CONTEXT_SOFT_LIMIT;
}
