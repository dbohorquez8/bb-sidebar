// WS-268 LC-2: the status file reader. Pure: no I/O, no clock.

import { STATUS_DIR } from "./status-constants";

export type ThreadKind = "orchestrator" | "implementer" | "worker" | "session";
export type StateCheck = "verified" | "unverified" | "unchecked";

export interface StatusFile {
  kind: ThreadKind;
  phase: string | null; // raw word; vocabulary applied by the resolver (AC-06)
  state: string | null; // raw word; vocabulary applied by the resolver (AC-06)
  stateCheck: StateCheck;
  counts: { done: number; total: number } | null; // null when empty or refused (D > T, non-integer, T < 1, wrong spacing)
  updatedMs: number; // epoch ms of the whole-second `updated` value
}

const KINDS: readonly ThreadKind[] = ["orchestrator", "implementer", "worker", "session"];
const STATE_CHECKS: readonly StateCheck[] = ["verified", "unverified", "unchecked"];
const KEY_ORDER = ["kind", "role", "phase", "state", "state-check", "counts", "updated"] as const;
const UPDATED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const COUNTS_RE = /^(\d+) \/ (\d+)$/;

/** <environmentPath>/.claude/status/<threadId>.md */
export function statusFilePath(environmentPath: string, threadId: string): string {
  const base = environmentPath.length > 1 ? environmentPath.replace(/\/+$/, "") : environmentPath;
  return `${base === "/" ? "" : base}/${STATUS_DIR}/${threadId}.md`;
}

/** Value of a `<key>:` or `<key>: <value>` line; undefined when the line has another shape. */
function valueOf(line: string, key: string): string | null | undefined {
  if (line === `${key}:`) return null;
  const prefix = `${key}: `;
  if (line.startsWith(prefix) && line.length > prefix.length) return line.slice(prefix.length);
  return undefined;
}

function parseCounts(raw: string | null): { done: number; total: number } | null {
  if (raw === null) return null;
  const m = COUNTS_RE.exec(raw);
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total)) return null;
  if (total < 1 || done > total) return null;
  return { done, total };
}

/** null = counts as no file (AC-05). */
export function parseStatusFile(text: string): StatusFile | null {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  if (lines.length < 9) return null;
  const head = lines.slice(0, 9);
  if (head.some((l) => l.includes("\r") || l.includes("�"))) return null;
  if (head[0] !== "---" || head[8] !== "---") return null;

  const values: Record<string, string | null> = {};
  for (let i = 0; i < KEY_ORDER.length; i++) {
    const key = KEY_ORDER[i];
    const v = valueOf(head[i + 1], key);
    if (v === undefined) return null;
    values[key] = v;
  }

  const kind = values.kind as ThreadKind | null;
  if (kind === null || !KINDS.includes(kind)) return null;
  const stateCheck = values["state-check"] as StateCheck | null;
  if (stateCheck === null || !STATE_CHECKS.includes(stateCheck)) return null;

  const updated = values.updated;
  if (updated === null || !UPDATED_RE.test(updated)) return null;
  const updatedMs = Date.parse(updated);
  if (Number.isNaN(updatedMs)) return null;
  // Reject rolled-over dates such as 2026-02-31.
  if (new Date(updatedMs).toISOString().slice(0, 19) + "Z" !== updated) return null;

  return {
    kind,
    phase: values.phase,
    state: values.state,
    stateCheck,
    counts: parseCounts(values.counts),
    updatedMs,
  };
}

/** Decodes a files.read answer ({ content, contentEncoding: "utf8" | "base64" }) with a fatal UTF-8 decoder; a decode error returns null. */
export function decodeFileBody(body: { content: string; contentEncoding?: string }): string | null {
  if (body === null || typeof body !== "object" || typeof body.content !== "string") return null;
  const encoding = body.contentEncoding ?? "utf8";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    if (encoding === "utf8") {
      // A JS string is already decoded; a fatal round trip catches lone surrogates.
      return decoder.decode(new TextEncoder().encode(body.content)) === body.content ? body.content : null;
    }
    if (encoding === "base64") {
      const binary = atob(body.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return decoder.decode(bytes);
    }
    return null;
  } catch {
    return null;
  }
}
