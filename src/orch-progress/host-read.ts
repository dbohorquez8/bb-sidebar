import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ORCH_MAX_GROUPS, ORCH_MAX_TICKETS, type OrchGroupEntry } from "./contract";
import { isGroupDirName, orchStateDir, parseLedger } from "./ledger";

// A ledger larger than this is not a record the orchestrator wrote; read it as unreadable.
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const BATCH = 32;

async function readGroup(root: string, groupId: string): Promise<OrchGroupEntry | null> {
  const path = join(root, groupId, "ledger.md");
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (info.size > MAX_LEDGER_BYTES) return { readable: false, groupId, mtimeMs: info.mtimeMs };
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return { readable: false, groupId, mtimeMs: info.mtimeMs };
  }
  const entry = parseLedger(content, groupId, info.mtimeMs);
  return entry.readable && entry.tickets.length > ORCH_MAX_TICKETS ? { ...entry, tickets: entry.tickets.slice(0, ORCH_MAX_TICKETS) } : entry;
}

/**
 * Read every `groups/<id>/ledger.md` under this machine's orchestrate state directory and return
 * the reduced entries, newest first. Opens files for reading only: no write, lock, spawn or message.
 * A missing state or groups directory is an empty list, not an error.
 */
export async function readOrchestratorGroups(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Promise<{ groups: OrchGroupEntry[] }> {
  const root = join(orchStateDir(env, home), "groups");
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { groups: [] };
    throw error;
  }
  const groups: OrchGroupEntry[] = [];
  const candidates = names.filter(isGroupDirName);
  for (let i = 0; i < candidates.length; i += BATCH) {
    const read = await Promise.all(candidates.slice(i, i + BATCH).map((name) => readGroup(root, name)));
    for (const entry of read) if (entry) groups.push(entry);
  }
  groups.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.groupId < b.groupId ? 1 : a.groupId > b.groupId ? -1 : 0));
  return { groups: groups.slice(0, ORCH_MAX_GROUPS) };
}
