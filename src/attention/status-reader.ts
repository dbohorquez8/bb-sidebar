// WS-268 I-1 to I-3: the server side of the status card. Server-only (it calls the server SDK and the plugin database).
//
// One `cards()` call reads BB's thread rows, the observer's folded history and the cached status files, runs the pure
// resolver for every thread, stores the memory (LC-8) and returns the finished cards. A file read never blocks the
// answer: a thread with no answer yet reads as "pending" (inference) until its file lands (D-8).

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { chimeClassOf, cardFor, nextMemory, type CardInput, type CardView, type SavedMemory } from "./card";
import { factsOf, type ServerThreadRow } from "./facts";
import type { AttentionRulesDocument } from "./rules";
import { ATTENTION_CHANNEL } from "./settings";
import {
  CHECK_THRESHOLD_DEFAULT_MINUTES,
  CHIME_FILE_WAIT_MS,
  EVENT_REREAD_MIN_GAP_MS,
  FAILED_REREAD_MS,
  FILE_READ_TIMEOUT_MS,
  MIDTURN_REREAD_MS,
  TURN_END_REREAD_MS,
  TURN_END_WINDOW_MS,
} from "./status-constants";
import { decodeFileBody, parseStatusFile, statusFilePath, type StatusFile, type ThreadKind } from "./status-file";
import type { HistoryFacts, ThreadObservation } from "./types";

/** LC-8. The reader also runs it, so it works on any database it is handed. */
export const THREAD_STATUS_MEMORY_TABLE = `CREATE TABLE IF NOT EXISTS thread_status_memory (
  thread_id    TEXT PRIMARY KEY,
  end_word     TEXT,
  end_word_at  INTEGER,
  needs_you_at INTEGER,
  card_key     TEXT,
  card_since   INTEGER
)`;

const PAGE = 200;

export interface ThreadCardRow {
  threadId: string;
  parentThreadId: string | null;
  card: CardView;
  since: number | null;
  chime: "needs-you" | "done" | "none";
  isChild: boolean;
  fileState: "pending" | "read" | "none";
  settled: boolean;
}
export interface GetThreadCardsOutput {
  cards: ThreadCardRow[];
}

interface FileEntry {
  path: string;
  hostId: string | null;
  /** Raw text of a readable file; null for no file, a failed read, or a malformed file. */
  text: string | null;
  file: StatusFile | null;
  /** Some read has answered (or timed out) for this entry. */
  answered: boolean;
  answeredAt: number;
  /** The last read threw (not ENOENT) or timed out: re-read every FAILED_REREAD_MS (D-8 (e)). */
  failed: boolean;
  /** The latest answer is the read timeout's, not the host's: a chime keeps waiting (AC-69a). */
  timedOut: boolean;
  lastStartedAt: number;
  gen: number;
  appliedGen: number;
}

interface MemoryRow {
  endWord: string | null;
  endWordAt: number | null;
  needsYouAt: number | null;
  cardKey: string | null;
  cardSince: number | null;
}

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** A missing file is not a failure (D-8 (e)). The SDK reports it as "HTTP 404: Path does not exist: <path>". */
export const isMissingFile = (error: unknown): boolean => {
  const e = error as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown } | null;
  return (
    e?.code === "ENOENT" ||
    e?.status === 404 ||
    e?.statusCode === 404 ||
    (typeof e?.message === "string" && /ENOENT|no such file|HTTP 404|Path does not exist/i.test(e.message))
  );
};

const EMPTY_HISTORY: HistoryFacts = {
  latestOwnerAt: null,
  clearedAt: null,
  turnStartedAt: null,
  turnEndedAt: null,
  needsYouBlockAt: null,
  closing: null,
  closingEndWord: null,
  lastActivityAt: null,
};

function historyOf(observation: ThreadObservation | undefined): HistoryFacts {
  if (!observation) return EMPTY_HISTORY;
  return {
    latestOwnerAt: observation.latestOwnerAt ?? null,
    clearedAt: observation.clearedAt ?? null,
    turnStartedAt: observation.turnStartedAt,
    turnEndedAt: observation.turnEndedAt,
    needsYouBlockAt: observation.needsYouBlockAt ?? null,
    closing: observation.closing ?? null,
    closingEndWord: observation.closingEndWord ?? null,
    lastActivityAt: observation.lastActivityAt,
  };
}

const floorSecond = (ms: number): number => Math.floor(ms / 1000) * 1000;

export function createStatusReader(
  bb: BbPluginApi,
  deps: {
    db: Db;
    observer: { list(threads: readonly { id: string; parentId: string | null }[]): Promise<{ observations: ThreadObservation[]; unavailable: string[] }> };
    rules: () => AttentionRulesDocument | null;
    now?: () => number;
  },
): {
  cards(threadIds?: readonly string[], silenceMinutes?: number): Promise<GetThreadCardsOutput>;
  dispose(): void;
} {
  const { db, observer } = deps;
  const now = deps.now ?? Date.now;
  db.exec(THREAD_STATUS_MEMORY_TABLE);

  const lastRows = new Map<string, ServerThreadRow>();
  const files = new Map<string, FileEntry>();
  const lastCursor = new Map<string, number | null>();
  const wasRunning = new Map<string, boolean>();
  const turnEndSeen = new Map<string, number>();
  /** The file-read generation the latest turn end started; the chime settles for a missing file once it has answered. */
  const turnEndGen = new Map<string, number>();
  const windowFor = new Map<string, { endMs: number; timers: ReturnType<typeof setTimeout>[] }>();
  let disposed = false;

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let parent = lastRows.get(id)?.parentThreadId ?? null;
    while (parent !== null && !seen.has(parent)) {
      out.push(parent);
      seen.add(parent);
      parent = lastRows.get(parent)?.parentThreadId ?? null;
    }
    return out;
  };

  // ------------------------------------------------------------------------------------------ file reads (I-2)
  function startRead(row: ServerThreadRow): void {
    if (disposed || row.environmentPath === null || row.environmentPath === "") return;
    const path = statusFilePath(row.environmentPath, row.id);
    const hostId = row.environmentHostId;
    let entry = files.get(row.id);
    if (!entry || entry.path !== path || entry.hostId !== hostId) {
      entry = { path, hostId, text: null, file: null, answered: false, answeredAt: 0, failed: false, timedOut: false, lastStartedAt: 0, gen: 0, appliedGen: 0 };
      files.set(row.id, entry);
    }
    const target = entry;
    target.lastStartedAt = now();
    const gen = ++target.gen;

    const apply = (text: string | null, file: StatusFile | null, failed: boolean, timedOut = false): void => {
      if (disposed || files.get(row.id) !== target || gen < target.appliedGen) return;
      target.appliedGen = gen;
      target.timedOut = timedOut;
      const changed = target.text !== text || (target.file?.updatedMs ?? null) !== (file?.updatedMs ?? null);
      target.text = text;
      target.file = file;
      target.failed = failed;
      target.answered = true;
      target.answeredAt = now();
      if (changed) bb.realtime.publish(ATTENTION_CHANNEL, { threadIds: [row.id, ...ancestorsOf(row.id)] });
    };

    // No answer in time counts as failed (inference); a late answer still replaces it.
    const timer = setTimeout(() => {
      if (target.appliedGen < gen) apply(null, null, true, true);
    }, FILE_READ_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();

    void Promise.resolve()
      .then(() => bb.sdk.files.read({ ...(hostId !== null ? { hostId } : {}), path } as never))
      .then(
        (body) => {
          clearTimeout(timer);
          const text = decodeFileBody(body as { content: string; contentEncoding?: string });
          const file = text === null ? null : parseStatusFile(text);
          apply(file === null ? null : text, file, false);
        },
        (error: unknown) => {
          clearTimeout(timer);
          apply(null, null, !isMissingFile(error));
        },
      );
  }

  function readGapLimited(id: string): void {
    const row = lastRows.get(id);
    if (!row) return;
    const entry = files.get(id);
    if (entry && now() - entry.lastStartedAt < EVENT_REREAD_MIN_GAP_MS) return;
    startRead(row);
  }

  // D-8 (c): after a turn end, read now and every TURN_END_REREAD_MS until TURN_END_WINDOW_MS or the file catches up.
  function startTurnEndWindow(id: string, endMs: number): void {
    if (windowFor.get(id)?.endMs === endMs) return;
    for (const t of windowFor.get(id)?.timers ?? []) clearTimeout(t);
    const timers: ReturnType<typeof setTimeout>[] = [];
    windowFor.set(id, { endMs, timers });
    const floor = floorSecond(endMs);
    const step = (): boolean => {
      const row = lastRows.get(id);
      if (disposed || !row) return false;
      const file = files.get(id)?.file ?? null;
      if (file !== null && file.updatedMs >= floor) return false;
      startRead(row);
      return true;
    };
    for (let at = 0; at <= TURN_END_WINDOW_MS; at += TURN_END_REREAD_MS) {
      if (at === 0) {
        // The read this turn end starts; a no-file chime settles when it has answered (settledOf).
        const started = step();
        const entry = files.get(id);
        if (started && entry) turnEndGen.set(id, entry.gen);
        else turnEndGen.delete(id);
      } else {
        const t = setTimeout(step, at);
        (t as { unref?: () => void }).unref?.();
        timers.push(t);
      }
    }
  }

  // ------------------------------------------------------------------------------------------ the schedule (I-3)
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      const id = event.id;
      if (typeof id !== "string" || id === "") return;
      const types = event.metadata?.eventTypes;
      if (!Array.isArray(types)) return;
      if (types.includes("turn/completed")) {
        const at = now();
        turnEndSeen.set(id, turnEndSeen.get(id) ?? at);
        startTurnEndWindow(id, turnEndSeen.get(id)!);
      } else if (types.length > 0) {
        readGapLimited(id);
      }
    },
  });
  const midTurn = setInterval(() => {
    for (const row of lastRows.values()) if (factsOf(row, null, now()).turnRunning) startRead(row);
  }, MIDTURN_REREAD_MS);
  const failedTimer = setInterval(() => {
    for (const [id, entry] of files) if (entry.failed) {
      const row = lastRows.get(id);
      if (row) startRead(row);
    }
  }, FAILED_REREAD_MS);
  (midTurn as { unref?: () => void }).unref?.();
  (failedTimer as { unref?: () => void }).unref?.();

  bb.events.on("thread.deleted", ({ thread }) => {
    db.prepare(`DELETE FROM thread_status_memory WHERE thread_id = ?`).run(thread.id);
    lastRows.delete(thread.id);
    files.delete(thread.id);
    lastCursor.delete(thread.id);
    wasRunning.delete(thread.id);
    turnEndSeen.delete(thread.id);
    turnEndGen.delete(thread.id);
    for (const t of windowFor.get(thread.id)?.timers ?? []) clearTimeout(t);
    windowFor.delete(thread.id);
  });

  // ------------------------------------------------------------------------------------------ the thread rows (I-1 step 1)
  async function listRows(): Promise<ServerThreadRow[] | null> {
    try {
      const all: ServerThreadRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = (await bb.sdk.threads.list({ archived: false, includeHidden: true, limit: PAGE, offset })) as unknown as ServerThreadRow[];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      return all.filter((row) => row.archivedAt === null || row.archivedAt === undefined);
    } catch {
      return null;
    }
  }

  function readMemory(): Map<string, MemoryRow> {
    const rows = db
      .prepare(`SELECT thread_id, end_word, end_word_at, needs_you_at, card_key, card_since FROM thread_status_memory`)
      .all() as Array<{ thread_id: string; end_word: string | null; end_word_at: number | null; needs_you_at: number | null; card_key: string | null; card_since: number | null }>;
    return new Map(
      rows.map((r) => [r.thread_id, { endWord: r.end_word, endWordAt: r.end_word_at, needsYouAt: r.needs_you_at, cardKey: r.card_key, cardSince: r.card_since }]),
    );
  }

  const settledOf = (id: string, turnRunning: boolean, turnEnd: number | null, at: number): boolean => {
    if (turnRunning || turnEnd === null) return true;
    if (at - turnEnd >= CHIME_FILE_WAIT_MS) return true;
    const entry = files.get(id);
    if (!entry) return true; // no environment: nothing to wait for
    if (!entry.answered) return false;
    if (entry.timedOut) return false; // a timeout is not an answer (AC-69a)
    if (entry.file !== null) return entry.file.updatedMs >= floorSecond(turnEnd);
    // No file: settled once the read this turn end started has answered. Comparing times would let an earlier
    // read that answered in the same millisecond as the turn end count as that read.
    const endGen = turnEndGen.get(id);
    return endGen !== undefined ? entry.appliedGen >= endGen : entry.answeredAt >= turnEnd;
  };

  return {
    async cards(threadIds, silenceMinutes = CHECK_THRESHOLD_DEFAULT_MINUTES) {
      const fresh = await listRows();
      if (fresh !== null) {
        const seen = new Set(fresh.map((r) => r.id));
        for (const id of [...lastRows.keys()]) if (!seen.has(id)) lastRows.delete(id);
        for (const row of fresh) lastRows.set(row.id, row);
      }
      const rows = [...lastRows.values()];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const kidsOf = new Map<string, ServerThreadRow[]>();
      for (const row of rows) {
        if (row.parentThreadId !== null && byId.has(row.parentThreadId)) {
          const list = kidsOf.get(row.parentThreadId) ?? [];
          list.push(row);
          kidsOf.set(row.parentThreadId, list);
        }
      }

      // The requested threads, their ancestors and all their descendants.
      let selected: ServerThreadRow[] = rows;
      if (threadIds !== undefined) {
        const keep = new Set<string>();
        const addDescendants = (id: string): void => {
          for (const kid of kidsOf.get(id) ?? []) if (!keep.has(kid.id)) {
            keep.add(kid.id);
            addDescendants(kid.id);
          }
        };
        for (const id of threadIds) {
          if (!byId.has(id)) continue;
          keep.add(id);
          for (const a of ancestorsOf(id)) keep.add(a);
          addDescendants(id);
        }
        selected = rows.filter((r) => keep.has(r.id));
      }

      // Step 2: folded history, with the cursor moves that re-read a file (D-8 (f)).
      const { observations } = await observer.list(selected.map((r) => ({ id: r.id, parentId: r.parentThreadId })));
      const obsOf = new Map(observations.map((o) => [o.threadId, o]));
      const at = now();
      for (const row of selected) {
        const obs = obsOf.get(row.id);
        if (obs === undefined) continue;
        if (lastCursor.has(row.id) && lastCursor.get(row.id) !== obs.cursorSeq) readGapLimited(row.id);
        lastCursor.set(row.id, obs.cursorSeq);
      }

      // Step 3: first sight of a thread starts its read; nothing waits for it (D-8 (d)).
      for (const row of selected) {
        const running = factsOf(row, null, at).turnRunning;
        if (running) {
          wasRunning.set(row.id, true);
          turnEndSeen.delete(row.id);
          turnEndGen.delete(row.id);
        } else if (wasRunning.get(row.id) === true) {
          wasRunning.set(row.id, false);
          turnEndSeen.set(row.id, turnEndSeen.get(row.id) ?? at);
          startTurnEndWindow(row.id, turnEndSeen.get(row.id)!);
        }
        if (!files.has(row.id) && row.environmentPath) startRead(row);
      }
      // Let a read that is already answered land; a slow host stays pending.
      for (let i = 0; i < 20; i += 1) await Promise.resolve();

      // Step 4: memory.
      const memory = readMemory();

      // Step 5: card inputs.
      const kindOfFile = (id: string): ThreadKind | null => {
        const text = files.get(id)?.text;
        return typeof text === "string" ? (parseStatusFile(text)?.kind ?? null) : null;
      };
      const rules = deps.rules();
      const inputFor = (row: ServerThreadRow, parentKind: ThreadKind | null, isChild: boolean): CardInput => {
        const obs = obsOf.get(row.id);
        const { bbWord, ...facts } = factsOf(row, obs ? { lastActivityAt: obs.lastActivityAt } : null, at);
        const hf = historyOf(obs);
        const mem = memory.get(row.id);
        let endWord = mem?.endWord ?? null;
        if (endWord !== null && mem?.endWordAt != null && hf.clearedAt !== null && mem.endWordAt < hf.clearedAt) endWord = null;
        const saved: SavedMemory = { endWord, needsYouAt: mem?.needsYouAt ?? null };        const ownKind = kindOfFile(row.id);
        return {
          id: row.id,
          file: files.get(row.id)?.text ?? null,
          parent: parentKind,
          isChild,
          facts,
          historyFacts: hf,
          children: (kidsOf.get(row.id) ?? []).map((kid) => inputFor(kid, ownKind, true)),
          saved,
          settings: { silenceMinutes },
          now: at,
          bbWord,
          neverRan: hf.turnStartedAt === null && hf.turnEndedAt === null && !facts.turnRunning,
          rules,
        };
      };

      // Step 6 and 7: a card and a memory row per thread.
      const out: ThreadCardRow[] = [];
      const upsert = db.prepare(
        `INSERT INTO thread_status_memory (thread_id, end_word, end_word_at, needs_you_at, card_key, card_since)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET end_word = excluded.end_word, end_word_at = excluded.end_word_at,
           needs_you_at = excluded.needs_you_at, card_key = excluded.card_key, card_since = excluded.card_since`,
      );
      for (const row of selected) {
        const parentRow = row.parentThreadId !== null ? byId.get(row.parentThreadId) : undefined;
        const isChild = row.parentThreadId !== null;
        const input = inputFor(row, parentRow ? kindOfFile(parentRow.id) : null, isChild);
        const card = cardFor(input);
        const next = nextMemory(input, card);
        const prev = memory.get(row.id);
        const cardKey = `${card.word ?? ""}|${card.tone ?? ""}|${card.icon}|${card.pill ? 1 : 0}`;
        const cardSince = prev?.cardKey === cardKey && prev.cardSince !== null ? prev.cardSince : at;
        const nextEnd = next.endWord ?? null;
        let endWordAt = prev?.endWordAt ?? null;
        if (nextEnd === null) endWordAt = null;
        else if (nextEnd !== (prev?.endWord ?? null) || endWordAt === null) {
          const file = files.get(row.id)?.file ?? null;
          endWordAt = file !== null && file.state === nextEnd ? file.updatedMs : at;
        }
        const needsYouAt = next.needsYouAt ?? null;
        if (
          !prev ||
          prev.endWord !== nextEnd ||
          prev.endWordAt !== endWordAt ||
          prev.needsYouAt !== needsYouAt ||
          prev.cardKey !== cardKey ||
          prev.cardSince !== cardSince
        ) {
          upsert.run(row.id, nextEnd, endWordAt, needsYouAt, cardKey, cardSince);
        }

        const entry = files.get(row.id);
        const fileState: ThreadCardRow["fileState"] = !entry || !entry.answered ? (row.environmentPath ? "pending" : "none") : entry.file !== null ? "read" : "none";
        const hf = input.historyFacts!;
        const running = input.facts?.turnRunning === true;
        const endedAt =
          !running && hf.turnEndedAt !== null && (hf.turnStartedAt === null || hf.turnEndedAt >= hf.turnStartedAt) ? hf.turnEndedAt : null;
        const seen = running ? null : (turnEndSeen.get(row.id) ?? null);
        const turnEnd = endedAt !== null && seen !== null ? Math.min(endedAt, seen) : (endedAt ?? seen);
        out.push({
          threadId: row.id,
          parentThreadId: row.parentThreadId,
          card,
          since: card.text !== null ? cardSince : null,
          chime: chimeClassOf(card, input),
          isChild,
          fileState,
          settled: settledOf(row.id, running, turnEnd, at),
        });
      }
      return { cards: out };
    },
    dispose() {
      disposed = true;
      clearInterval(midTurn);
      clearInterval(failedTimer);
      for (const w of windowFor.values()) for (const t of w.timers) clearTimeout(t);
      windowFor.clear();
      try {
        unsubscribe();
      } catch {
        /* already gone */
      }
    },
  };
}
