// The composer (WS-268, LC-11): fetches the server's cards, fills the time label, applies the per-client Draft word, and
// runs the chime rule. Browser-side; it holds timers, so `attention/index.ts` does not re-export it.

import { detectEntries, startListening, type EntryTracker } from "../sounds/entries";
import { BB_TONE } from "./card";
import type { CardView } from "./card-view";
import { formatTimeInStatus } from "./format";
import { CHIME_FILE_WAIT_MS, COMPOSE_POLL_MS } from "./status-constants";

export interface ChimePlayer {
  play(sound: "needs-you" | "done", threadId: string): void;
}
export type CallRpc = (method: string, input?: unknown) => Promise<unknown>;
export interface Composer {
  /** One getThreadCards fetch; takes the chime baseline (AC-70); starts the COMPOSE_POLL_MS timer. */
  load(): Promise<void>;
  /** A fresh fetch, then the thread's card with timeLabel filled; IDLE when unknown or the RPC fails with nothing cached. */
  card(threadId: string): Promise<CardView>;
  /** The last fetched set. */
  cards(): ReadonlyMap<string, CardView>;
  /** True when the last fetches hold a row for the thread. */
  has(threadId: string): boolean;
  /** Refresh now (ATTENTION_CHANNEL in the browser). */
  notify(threadIds?: readonly string[]): void;
  /** Stops the timer; no chime after dispose. */
  dispose(): void;
}

/** One row of the `getThreadCards` answer (LC-10). */
interface CardRow {
  threadId: string;
  parentThreadId: string | null;
  card: CardView;
  since: number | null;
  chime: "needs-you" | "done" | "none";
  isChild: boolean;
  fileState: "pending" | "read" | "none";
  settled: boolean;
}

const IDLE: CardView = { word: null, count: null, text: null, tone: null, icon: "none", pill: false, hint: null, bar: null, timeLabel: null };

/** BB's own words that show no time (today's `isTimedStatus`). */
const UNTIMED_WORDS: ReadonlySet<string> = new Set(["Draft", "Queued"]);

export function composeWorld(deps: {
  callRpc: CallRpc;
  chimePlayer: ChimePlayer;
  now?: () => number;
  overlay?: (threadId: string) => { draft: boolean };
  /** BB's createdAt for a thread, when the sidebar's thread list has it (an older thread first seen later is baseline). */
  createdAtOf?: (threadId: string) => number | undefined;
  /** Called after each fetch has merged its rows (the hook re-renders from it). */
  onChange?: () => void;
}): Composer {
  const now = deps.now ?? Date.now;
  const rows = new Map<string, CardRow>();

  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // Fetches run one at a time, so a poll and a notice never interleave their chime rule.
  let chain: Promise<unknown> = Promise.resolve();

  // Chime state.
  let tracker: EntryTracker | null = null;
  const sightingFile = new Map<string, "pending" | "read" | "none">();
  const unsettledSince = new Map<string, number>();
  const pendingPlays: { sound: "needs-you" | "done"; threadId: string }[] = [];
  let queued = 0;
  const sightingState = new Map<string, { childRunning: boolean; tone: CardView["tone"]; chime: "needs-you" | "done" | "none" }>();

  const viewOf = (row: CardRow): CardView => {
    let card = row.card;
    if (card.text === null && deps.overlay?.(row.threadId).draft) {
      card = { ...IDLE, word: "Draft", text: "Draft", tone: BB_TONE.Draft ?? null };
    }
    const timed = card.text !== null && !UNTIMED_WORDS.has(card.word ?? "") && row.since !== null;
    return { ...card, timeLabel: timed ? formatTimeInStatus(row.since as number, now()) : null };
  };

  async function playChimes(fetched: readonly CardRow[], baseline: boolean, full: boolean): Promise<void> {
    const at = now();
    const statuses = new Map<string, string>(tracker ? tracker.held : []);
    const quiet = new Set<string>(); // changes that must not chime (AC-70)
    for (const row of fetched) {
      if (row.isChild) continue;
      const previousFile = sightingFile.get(row.threadId);
      sightingFile.set(row.threadId, row.fileState);
      if (!row.settled) {
        const since = unsettledSince.get(row.threadId) ?? at;
        unsettledSince.set(row.threadId, since);
        // The turn's file is still awaited: hold the class we had until it settles or the wait ends.
        if (at - since < CHIME_FILE_WAIT_MS && statuses.has(row.threadId)) continue;
      } else {
        unsettledSince.delete(row.threadId);
      }
      if (previousFile === "pending") quiet.add(row.threadId);
      // A Done held while a child ran (AC-64) stays silent for good: when the child stops and the class turns on,
      // that is a hold lifting, not a fresh transition. The previous sighting had a running child and the
      // thread's own turn was not running (a yellow card), so the end was reached under the hold.
      const previous = sightingState.get(row.threadId);
      const childRunning = [...rows.values()].some(
        (other) => other.parentThreadId === row.threadId && (other.card.tone === "yellow" || other.card.tone === "green"),
      );
      if (previous !== undefined && previous.childRunning && previous.tone !== "yellow" && previous.chime === "none") quiet.add(row.threadId);
      sightingState.set(row.threadId, { childRunning, tone: row.card.tone, chime: row.chime });
      statuses.set(row.threadId, row.chime);
    }
    // Threads the sidebar created after listening began are new; older ones first seen later are baseline
    // (a thread unarchived while in Needs you makes no sound).
    // A full fetch lists every non-archived thread, so a held thread missing from it was archived (or deleted):
    // when it comes back it is a returning thread, not a new entry.
    const archived = new Set<string>();
    if (full && tracker !== null) {
      const fetchedIds = new Set(fetched.map((row) => row.threadId));
      for (const id of tracker.held.keys()) {
        if (!fetchedIds.has(id)) {
          archived.add(id);
          statuses.delete(id);
        }
      }
    }
    const createdAt = new Map<string, number>();
    for (const row of fetched) {
      const created = deps.createdAtOf?.(row.threadId);
      if (created !== undefined) createdAt.set(row.threadId, created);
    }
    if (baseline || tracker === null) {
      tracker = startListening({ statuses, createdAt, archived: new Set() }, at);
      return;
    }
    const held = new Map(tracker.held);
    for (const id of quiet) if (statuses.has(id)) held.set(id, statuses.get(id) as string);
    const detected = detectEntries({ ...tracker, held }, { statuses, createdAt, archived }, at);
    tracker = detected.tracker;
    if (detected.entries.length === 0 || disposed) return;
    // The class switches are read here. The main switch (`playSounds`) is enforced downstream by the browser's
    // audible pipeline (`isAudibleEntry`), which every `chimePlayer.play` goes through.
    const settings = await deps
      .callRpc("getSoundSettings", {})
      .then((value) => value as { needsYouEnabled?: boolean; doneEnabled?: boolean })
      .catch(() => null);
    if (settings === null || disposed) return;
    for (const entry of detected.entries) {
      if (entry.status === "needs-you" ? settings.needsYouEnabled !== true : settings.doneEnabled !== true) continue;
      pendingPlays.push({ sound: entry.status, threadId: entry.threadId });
    }
  }

  // Needs you first (AC-48): entries found by fetches queued together are one update. They play together, Needs you
  // before Done, so the quiet period that follows the Needs you sound covers the Done. The batch plays when the last
  // queued fetch ends (no timer: a timer started at the end of a tick can fire after the tick that owns it).
  function flushPlays(): void {
    const batch = pendingPlays.splice(0);
    if (disposed) return;
    batch.sort((a, b) => Number(b.sound === "needs-you") - Number(a.sound === "needs-you"));
    for (const play of batch) deps.chimePlayer.play(play.sound, play.threadId);
  }

  async function fetchOnce(threadIds: readonly string[] | undefined, baseline: boolean): Promise<boolean> {
    let answer: { cards?: CardRow[] };
    try {
      answer = (await deps.callRpc("getThreadCards", threadIds ? { threadIds: [...threadIds] } : {})) as { cards?: CardRow[] };
    } catch {
      return false;
    }
    if (disposed) return false;
    const fetched = answer.cards ?? [];
    if (!threadIds) rows.clear();
    for (const row of fetched) rows.set(row.threadId, row);
    deps.onChange?.();
    await playChimes(threadIds ? fetched.filter((row) => !row.isChild) : fetched, baseline, !threadIds);
    return true;
  }

  function refresh(threadIds?: readonly string[], baseline = false): Promise<boolean> {
    queued += 1;
    const run = chain.then(async () => {
      try {
        return disposed ? false : await fetchOnce(threadIds, baseline);
      } finally {
        queued -= 1;
        if (queued === 0) flushPlays();
      }
    });
    chain = run.catch(() => undefined);
    return run;
  }

  function startTimer(): void {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => {
      void refresh();
    }, COMPOSE_POLL_MS);
  }

  return {
    async load() {
      if (disposed) return;
      tracker = null; // the next successful fetch is the baseline (AC-70)
      sightingFile.clear();
      unsettledSince.clear();
      sightingState.clear();
      startTimer();
      // A failed first fetch leaves no baseline; the poll retries and the first success takes it.
      await refresh(undefined, true);
    },
    async card(threadId) {
      await refresh();
      const row = rows.get(threadId);
      return row ? viewOf(row) : IDLE;
    },
    has(threadId) {
      return rows.has(threadId);
    },
    cards() {
      const out = new Map<string, CardView>();
      for (const [id, row] of rows) out.set(id, viewOf(row));
      return out;
    },
    notify(threadIds) {
      void refresh(threadIds && threadIds.length > 0 ? threadIds : undefined);
    },
    dispose() {
      disposed = true;
      pendingPlays.length = 0;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
