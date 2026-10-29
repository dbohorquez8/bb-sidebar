import type { OrchGroupEntry, OrchTicket } from "./contract";

const MARKER = "<!-- orchestrate-ledger-json";
const TERMINATOR = "-->";
const EPIC_ID = /^[A-Za-z]+-[0-9]+$/;
const GROUP_DIR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TEXT = 200;

/** A recorded epic id: letters, a dash, digits. Anything else is "no epic". */
export function isEpicId(value: unknown): value is string {
  return typeof value === "string" && EPIC_ID.test(value);
}

/** A group directory name the orchestrator itself would have written. */
export function isGroupDirName(name: string): boolean {
  return GROUP_DIR.test(name);
}

/** Where the orchestrate plugin keeps its state on this machine. */
export function orchStateDir(env: Record<string, string | undefined>, home: string): string {
  if (env.ORCHESTRATE_STATE_DIR) return env.ORCHESTRATE_STATE_DIR;
  const base = env.XDG_STATE_HOME || `${home}/.local/state`;
  return `${base}/orchestrate`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, MAX_TEXT) : null);

function hasQuestion(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (isObject(v)) return Object.keys(v).length > 0;
  return false;
}

function reduceTicket(id: string, state: unknown): OrchTicket {
  const s = isObject(state) ? state : {};
  return {
    id: id.slice(0, MAX_TEXT),
    phase: text(s.phase),
    stopKind: text(s.stop_kind),
    hasQuestion: hasQuestion(s.question),
    verification: text(s.verification),
    threadId: text(s.thread_id),
    trackerStatus: text(s.tracker_status),
  };
}

/**
 * Reduce the text of one ledger.md to the fields the sidebar uses. Never throws: a record
 * that is not a minimum readable record (plan 3.2) comes back as `readable: false`.
 */
export function parseLedger(content: string, groupId: string, mtimeMs: number): OrchGroupEntry {
  const unreadable: OrchGroupEntry = { readable: false, groupId, mtimeMs };
  const lines = content.split("\n", 4).map((line) => line.replace(/\r$/, ""));
  if (lines[0] !== MARKER || lines[2] !== TERMINATOR) return unreadable;
  let header: unknown;
  try {
    header = JSON.parse(lines[1]);
  } catch {
    return unreadable;
  }
  if (!isObject(header)) return unreadable;
  const { caller, tickets, state } = header;
  if (typeof caller !== "string" || caller === "" || !Array.isArray(tickets)) return unreadable;
  const states = isObject(state) ? state : {};
  const seen = new Set<string>();
  const reduced: OrchTicket[] = [];
  for (const id of tickets) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    reduced.push(reduceTicket(id, Object.hasOwn(states, id) ? states[id] : undefined));
  }
  return { readable: true, groupId, mtimeMs, caller, epic: isEpicId(header.epic) ? header.epic : null, tickets: reduced };
}
