import type { AttentionInput } from "./status";
import type { ResolvedStatus, ThreadObservation } from "./types";

export const STATUS_SINCE_STORAGE_KEY = "bb-sidebar:attention-since:v1";
export const FAILED_ACK_STORAGE_KEY = "bb-sidebar:attention-failed-ack:v1";

export function statusKey(status: ResolvedStatus): string {
  throw new Error("not implemented");
}

export interface StatusSinceEntry {
  key: string;
  since: number;
}

export function historySince(
  status: ResolvedStatus,
  input: AttentionInput,
  observation: ThreadObservation | null,
): number | null {
  throw new Error("not implemented");
}

export function reconcileStatusSince(
  previous: ReadonlyMap<string, StatusSinceEntry>,
  current: ReadonlyMap<string, string>, // threadId → statusKey
  now: number, // Date.now(), not the minute-quantized clock
  historySinceOf: (threadId: string) => number | null,
): ReadonlyMap<string, StatusSinceEntry> {
  throw new Error("not implemented");
}

export function reconcileFailedAck(
  previous: ReadonlySet<string>,
  failing: ReadonlySet<string>, // threads whose failure is reported (before ack)
  activeThreadId: string | null,
  previousActiveThreadId: string | null,
): ReadonlySet<string> {
  throw new Error("not implemented");
}

export function readStatusSince(): ReadonlyMap<string, StatusSinceEntry> {
  throw new Error("not implemented");
}

export function writeStatusSince(map: ReadonlyMap<string, StatusSinceEntry>): void {
  throw new Error("not implemented");
}

export function readFailedAck(): ReadonlySet<string> {
  throw new Error("not implemented");
}

export function writeFailedAck(set: ReadonlySet<string>): void {
  throw new Error("not implemented");
}
