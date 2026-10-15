// Browser-storage adapter for the per-thread "since" stamps and failure acks.
// Outside src/attention/ so the pure core never touches localStorage.
import { safeSetItem } from "./lib/safe-storage";
import type { StatusSinceEntry } from "./attention";

export const STATUS_SINCE_STORAGE_KEY = "bb-sidebar:attention-since:v1";
export const FAILED_ACK_STORAGE_KEY = "bb-sidebar:attention-failed-ack:v1";

export function readStatusSince(): ReadonlyMap<string, StatusSinceEntry> {
  try {
    const stored = window.localStorage.getItem(STATUS_SINCE_STORAGE_KEY);
    if (stored === null) return new Map();
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const map = new Map<string, StatusSinceEntry>();
    for (const [threadId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value !== null &&
        typeof value === "object" &&
        typeof (value as Partial<StatusSinceEntry>).key === "string" &&
        typeof (value as Partial<StatusSinceEntry>).since === "number" &&
        Number.isFinite((value as Partial<StatusSinceEntry>).since)
      ) {
        map.set(threadId, { key: (value as StatusSinceEntry).key, since: (value as StatusSinceEntry).since });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export function writeStatusSince(map: ReadonlyMap<string, StatusSinceEntry>): void {
  const obj: Record<string, StatusSinceEntry> = {};
  for (const [threadId, entry] of map) obj[threadId] = entry;
  safeSetItem(STATUS_SINCE_STORAGE_KEY, JSON.stringify(obj));
}

export function readFailedAck(): ReadonlySet<string> {
  try {
    const stored = window.localStorage.getItem(FAILED_ACK_STORAGE_KEY);
    if (stored === null) return new Set();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function writeFailedAck(set: ReadonlySet<string>): void {
  safeSetItem(FAILED_ACK_STORAGE_KEY, JSON.stringify([...set]));
}
