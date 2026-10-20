import type { OrchGroupEntry } from "./contract";
import type { OrchGroupModel } from "./state";

/** Last good reading per host, per group (plan 3.8). */
export type OrchHeld = ReadonlyMap<string, ReadonlyMap<string, OrchGroupModel>>;
export type OrchGroupsResult = { hosts: ReadonlyArray<{ hostId: string; groups: readonly OrchGroupEntry[] }> };

const sameReading = (a: OrchGroupModel, b: OrchGroupModel) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fold one rpc result into the held readings: a readable entry replaces its reading, a damaged
 * entry keeps it, a group no longer listed is dropped, and a host missing from the result loses
 * every reading. Returns `held` itself when nothing changed, and keeps unchanged readings by
 * reference so cards do not re-render.
 */
export function mergeReadings(held: OrchHeld, result: OrchGroupsResult): OrchHeld {
  const next = new Map<string, ReadonlyMap<string, OrchGroupModel>>();
  let changed = held.size !== result.hosts.length;
  for (const { hostId, groups } of result.hosts) {
    const before = held.get(hostId);
    const after = new Map<string, OrchGroupModel>();
    for (const entry of groups) {
      const old = before?.get(entry.groupId);
      if (entry.readable) after.set(entry.groupId, old && sameReading(old, entry) ? old : entry);
      else if (old) after.set(entry.groupId, old);
    }
    const hostSame = before !== undefined && before.size === after.size && [...after].every(([id, reading]) => before.get(id) === reading);
    if (!hostSame) changed = true;
    next.set(hostId, hostSame ? before : after);
  }
  return changed ? next : held;
}

/** The group a thread orchestrates: its own host, `caller` match, newest record, never empty. */
export function groupForThread(held: OrchHeld, thread: { id: string; host: { id: string } | null }): OrchGroupModel | null {
  if (thread.host === null) return null;
  let best: OrchGroupModel | null = null;
  for (const reading of held.get(thread.host.id)?.values() ?? []) {
    if (reading.caller !== thread.id) continue;
    if (best === null || reading.mtimeMs > best.mtimeMs || (reading.mtimeMs === best.mtimeMs && reading.groupId > best.groupId)) best = reading;
  }
  return best !== null && best.tickets.length > 0 ? best : null;
}
