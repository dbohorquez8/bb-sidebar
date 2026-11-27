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

  const viewOf = (row: CardRow): CardView => {
    let card = row.card;
    if (card.text === null && deps.overlay?.(row.threadId).draft) {
      card = { ...IDLE, word: "Draft", text: "Draft", tone: BB_TONE.Draft ?? null };
    }
    const timed = card.text !== null && !UNTIMED_WORDS.has(card.word ?? "") && row.since !== null;
    return { ...card, timeLabel: timed ? formatTimeInStatus(row.since as number, now()) : null };
  };

  async function playChimes(fetched: readonly CardRow[], baseline: boolean): Promise<void> {
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
      statuses.set(row.threadId, row.chime);
    }
    if (baseline || tracker === null) {
      tracker = startListening({ statuses, createdAt: new Map(), archived: new Set() }, at);
      return;
    }
    const held = new Map(tracker.held);
    for (const id of quiet) if (statuses.has(id)) held.set(id, statuses.get(id) as string);
    const detected = detectEntries({ ...tracker, held }, { statuses, createdAt: new Map(), archived: new Set() }, at);
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
      deps.chimePlayer.play(entry.status, entry.threadId);
    }
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
    await playChimes(threadIds ? fetched.filter((row) => !row.isChild) : fetched, baseline);
    return true;
  }

  function refresh(threadIds?: readonly string[], baseline = false): Promise<boolean> {
    const run = chain.then(() => (disposed ? false : fetchOnce(threadIds, baseline)));
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
      startTimer();
      // A failed first fetch leaves no baseline; the poll retries and the first success takes it.
      await refresh(undefined, true);
    },
    async card(threadId) {
      await refresh();
      const row = rows.get(threadId);
      return row ? viewOf(row) : IDLE;
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
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
