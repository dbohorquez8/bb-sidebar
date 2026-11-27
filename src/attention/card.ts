// WS-268 LC-4 / LC-6: the pure resolver. One card per thread from the status file, BB's live facts, the folded history,
// the thread's children and the remembered memory. No I/O, no clock reads except the `now` default.

import { BB_WORD_LABELS, formatTimeInStatus } from "./format";
import { applyObservationEvent, rowsToObservationEvents } from "./observation";
import { parseAttentionRules, type AttentionRulesDocument } from "./rules";
import { ATTENTION_RULES_EXAMPLE } from "./rules-assets";
import { CHECK_THRESHOLD_DEFAULT_MINUTES } from "./status-constants";
import { parseStatusFile, type ThreadKind } from "./status-file";
import type { HistoryFacts, ThreadEventRowLike, ThreadObservation } from "./types";
import { effectiveKind, PHASE_WORDS, STATE_WORDS } from "./vocabulary";
import { LOOK, type BarSegment, type CardView, type LookKey, type Tone } from "./card-view";

export * from "./card-view";

/** What BB reports right now; an absent field is absent (spec, Dependency edges). */
export interface LiveFacts {
  turnRunning?: boolean;
  pending?: boolean;
  failure?: boolean;
  background?: number;
  unread?: boolean;
  silentMin?: number;
  turnStartedAt?: number;
}

/** What `thread_status_memory` holds for one thread (LC-8). */
export interface SavedMemory {
  /** Remembered end word (AC-44, OQ-7 A). */
  endWord?: string | null;
  /** A sticky Needs you seen from a pending interaction or a file (AC-48, AC-49). */
  needsYouAt?: number | null;
}

export interface CardInput {
  id?: string;
  /** Raw status-file text; null or absent = no file or failed read. */
  file?: string | null;
  /** The parent's file kind; null also when the parent has no file. */
  parent?: ThreadKind | null;
  /** Default: `parent != null`; a thread listed under `children` is a child. */
  isChild?: boolean;
  facts?: LiveFacts;
  /** BB event rows, ascending seq; folded with `foldHistory`. */
  history?: ThreadEventRowLike[];
  /** Pre-folded (server path); wins over `history`. */
  historyFacts?: HistoryFacts;
  children?: CardInput[];
  saved?: SavedMemory;
  settings?: { silenceMinutes?: number };
  now?: number;
  bbWord?: "Draft" | "Queued" | "Planning" | "Goal" | null;
  neverRan?: boolean;
  /** The muted age (AC-39). */
  statusAgeMin?: number;
  /** Default: the parsed ATTENTION_RULES_EXAMPLE; null = no document. */
  rules?: AttentionRulesDocument | null;
}

let defaultRulesDocument: AttentionRulesDocument | null | undefined;
function defaultRules(): AttentionRulesDocument | null {
  if (defaultRulesDocument === undefined) defaultRulesDocument = parseAttentionRules(ATTENTION_RULES_EXAMPLE).document;
  return defaultRulesDocument;
}

/** The folded history: a reduce over `rowsToObservationEvents` with `applyObservationEvent`, as the observer does (D-4). */
export function foldHistory(rows: readonly ThreadEventRowLike[], rules: AttentionRulesDocument | null): HistoryFacts {
  let observation: ThreadObservation | undefined;
  for (const event of rowsToObservationEvents(rows)) observation = applyObservationEvent(observation, "fold", event, rules);
  return {
    latestOwnerAt: observation?.latestOwnerAt ?? null,
    clearedAt: observation?.clearedAt ?? null,
    turnStartedAt: observation?.turnStartedAt ?? null,
    turnEndedAt: observation?.turnEndedAt ?? null,
    needsYouBlockAt: observation?.needsYouBlockAt ?? null,
    closing: observation?.closing ?? null,
    closingEndWord: observation?.closingEndWord ?? null,
    lastActivityAt: observation?.lastActivityAt ?? null,
  };
}

const wholeSecond = (ms: number): number => Math.floor(ms / 1000);

/** Same-second rule (D-10): true when the file's updated second is later than the second of `eventAt`. */
export function fileCountsAfter(updatedMs: number, eventAt: number | null): boolean {
  return eventAt === null || wholeSecond(updatedMs) > wholeSecond(eventAt);
}

const END_WORDS = new Set(["Finalized", "Stopped", "Wrapped", "Handed over", "Landed"]);
/** Words that come from a reply's closing: an unchecked file does not decide them (AC-07). */
const CLOSING_DERIVED = new Set(["Done", "Waiting", "Working", "Needs you", "Asking"]);
const END_LOOK: Readonly<Record<string, LookKey>> = {
  Finalized: "finalized",
  Landed: "landed",
  Stopped: "stopped",
  Wrapped: "wrapped",
  "Handed over": "handed-over",
  Done: "done-child",
};
const BB_TONE: Readonly<Record<string, Tone>> = { Draft: "orange", Queued: "orange", Planning: "muted", Goal: "green" };

function mk(key: LookKey, word: string, o: { count?: string | null; hint?: string | null; bar?: BarSegment[] | null } = {}): CardView {
  const look = LOOK[key];
  const count = o.count ?? null;
  return {
    word,
    count,
    text: count === null ? word : `${word} ${count}`,
    tone: look.tone,
    icon: look.icon,
    pill: look.pill,
    hint: o.hint ?? null,
    bar: o.bar ?? null,
    timeLabel: null,
  };
}

const IDLE_CARD: CardView = { word: null, count: null, text: null, tone: null, icon: "none", pill: false, hint: null, bar: null, timeLabel: null };
const runningHint = (n: number): string | null => (n > 0 ? `${n} running` : null);

interface Resolved {
  card: CardView;
  /** The card is Asking or Approval (a child that lifts its top-level ancestor, C8). */
  asks: boolean;
  /** Some descendant asks. */
  descAsks: boolean;
  /** The card is a live word (spinner, gear, ticket) that holds its parent in the green lift. */
  running: boolean;
  /** The end word the thread holds, for the memory (AC-44); null when none or reset. */
  endWord: string | null;
  /** C6: the file was reset by /clear. */
  reset: boolean;
  /** The file's Needs you that counts (C2), with its `updated` ms. */
  fileNeedsYouAt: number | null;
  isChild: boolean;
}

function resolve(input: CardInput): Resolved {
  const rules = input.rules === undefined ? defaultRules() : input.rules;
  const facts = input.facts ?? {};
  const hf = input.historyFacts ?? foldHistory(input.history ?? [], rules);
  const file = typeof input.file === "string" ? parseStatusFile(input.file) : null;
  const isChild = input.isChild ?? input.parent != null;
  const kind = effectiveKind(file?.kind ?? null, { isChild, parentKind: input.parent ?? null });
  const threshold = input.settings?.silenceMinutes ?? CHECK_THRESHOLD_DEFAULT_MINUTES;

  const turnRunning = facts.turnRunning === true;
  const pending = facts.pending === true;
  const failure = facts.failure === true;
  const background = facts.background ?? 0;
  const unread = facts.unread === true;
  const turnStartedAt = hf.turnStartedAt ?? facts.turnStartedAt ?? null;
  const cutoff = Math.max(hf.latestOwnerAt ?? -Infinity, hf.clearedAt ?? -Infinity);
  const cutoffAt = Number.isFinite(cutoff) ? cutoff : null;

  // ---- the file after the vocabulary filter (C4, AC-06) and the state check (C5, AC-07)
  const rawState = file?.state ?? null;
  let state: string | null = null;
  let phase: string | null = null;
  let counts: string | null = null;
  let barTotals: { done: number; total: number } | null = null;
  if (file !== null && kind !== null) {
    if (rawState !== null && STATE_WORDS[kind].includes(rawState)) state = rawState;
    if (file.stateCheck === "unchecked" && state !== null && CLOSING_DERIVED.has(state)) state = null;
    if (file.phase !== null && PHASE_WORDS[kind].includes(file.phase) && (file.phase !== "Running" || file.counts !== null)) {
      phase = file.phase;
      if (file.counts !== null) {
        counts = `${file.counts.done} / ${file.counts.total}`;
        barTotals = file.counts;
      }
    }
  }
  const reset = file !== null && file.phase === null && file.state === null && file.counts === null && file.stateCheck === "unchecked";

  // ---- children first (the lift, the hint and the bar read them)
  const kids = (input.children ?? []).map((child) =>
    resolve({ ...child, isChild: child.isChild ?? true, parent: child.parent !== undefined ? child.parent : (file?.kind ?? null) }),
  );
  const runningKids = kids.filter((k) => k.running).length;
  const descAsks = kids.some((k) => k.asks || k.descAsks);
  const runningTurnKids = (input.children ?? []).filter((c) => c.facts?.turnRunning === true).length;

  // ---- history words
  const closing = hf.closing === "needs-you" ? null : hf.closing;
  const closingWorking = closing === "working";
  const fileDone = state === "Done";
  const isDone = fileDone || closing === "done";

  // ---- the end word the thread holds (E: AC-40 to AC-44), by source priority
  const savedEnd = reset ? null : (input.saved?.endWord ?? null);
  let endWord: string | null = null;
  const verified = state === "Verified";
  if (state !== null && END_WORDS.has(state)) endWord = state;
  else if (!verified) {
    if (savedEnd !== null && (savedEnd !== "Done" || isChild)) endWord = savedEnd;
    else if (hf.closingEndWord === "Finalized" || closing === "finalized") endWord = "Finalized";
    else if (isChild && (isDone || hf.closingEndWord === "Done")) endWord = "Done";
  }
  // A worker's vocabulary has one end word (Done), whatever closed it (writer table: Stopped, Wrapped, Finalized give Done).
  if (kind === "worker" && isChild && endWord !== null) endWord = "Done";
  if (state === "Handing over") endWord = null; // Handing over replaces it (AC-41)

  const greenWord = (): { word: string; count: string | null } =>
    phase !== null ? { word: phase, count: counts } : { word: kind === "worker" && isChild ? "Working" : "Waiting", count: null };

  const bar = (word: string): BarSegment[] | null => {
    if (word !== "Building" || barTotals === null || (kind !== "implementer" && kind !== "group-child")) return null;
    const { done, total } = barTotals;
    const pulsing = Math.min(runningTurnKids, Math.max(total - done, 0));
    return Array.from({ length: total }, (_, i): BarSegment => (i < done ? "green" : i < done + pulsing ? "pulsing" : "empty"));
  };

  const out = (card: CardView, flags: Partial<Pick<Resolved, "asks" | "running">> = {}): Resolved => ({
    card,
    asks: flags.asks ?? false,
    descAsks,
    running: flags.running ?? false,
    endWord,
    reset,
    fileNeedsYouAt: !isChild && state === "Needs you" && file !== null && fileCountsAfter(file.updatedMs, cutoffAt) ? file.updatedMs : null,
    isChild,
  });

  // ================================================================ step 1: Needs you (top-level) / Approval, Asking (child)
  if (isChild) {
    if (pending) return out(mk("approval", "Approval"), { asks: true });
    const askBlock = hf.needsYouBlockAt !== null && (turnStartedAt === null || hf.needsYouBlockAt > turnStartedAt);
    const askFile =
      file !== null &&
      file.stateCheck !== "unchecked" &&
      (rawState === "Asking" || rawState === "Needs you") &&
      fileCountsAfter(file.updatedMs, turnStartedAt);
    if (askBlock || askFile) return out(mk("asking", "Asking"), { asks: true });
  } else {
    const savedNeedsYou = reset ? null : (input.saved?.needsYouAt ?? null);
    const stickyNeedsYou = savedNeedsYou !== null && (cutoffAt === null || savedNeedsYou > cutoffAt);
    const fileNeedsYou = state === "Needs you" && file !== null && fileCountsAfter(file.updatedMs, cutoffAt);
    if (pending || hf.needsYouBlockAt !== null || stickyNeedsYou || fileNeedsYou || descAsks) return out(mk("needs-you", "Needs you"));
  }

  // ================================================================ step 2: Failed, while the turn is not running
  if (!turnRunning) {
    const failedFile = state === "Failed" && file !== null && fileCountsAfter(file.updatedMs, turnStartedAt);
    if (failure || failedFile) return out(mk("failed", "Failed"));
  }

  // ================================================================ step 2b: Handing over, running or not
  if (state === "Handing over") return out(mk("handing-over", "Handing over"));

  // ================================================================ step 3: the yellow live word
  if (turnRunning) {
    const word = phase ?? "Working";
    return out(mk("running", word, { count: phase !== null ? counts : null, bar: bar(word) }), { running: true });
  }

  // ================================================================ step 4: end word, or Verified
  if (endWord !== null) {
    const hint = runningHint(background + runningKids);
    return out(mk(END_LOOK[endWord] ?? "done-child", endWord, { hint }));
  }
  if (verified) return out(mk("verified", "Verified"));

  // ================================================================ step 5: top-level Done with leftover background work
  if (!isChild && isDone && background > 0 && runningKids === 0) {
    return out(mk(unread ? "done-unread" : "done-read", "Done", { hint: runningHint(background) }));
  }

  // ================================================================ step 6: Check? (top-level only)
  if (!isChild && !isDone && (facts.silentMin ?? 0) >= threshold && (background > 0 || closingWorking)) {
    return out(mk("check", "Check?"));
  }

  // ================================================================ step 7: queued word, then the green live word
  const waitingOnWork = background > 0 || runningKids > 0;
  if (waitingOnWork && (phase === "Gates queued" || phase === "CI queued")) {
    return out(mk("queued-gates", phase), { running: true });
  }
  if (waitingOnWork || closingWorking) {
    const { word, count } = greenWord();
    const markerOnly = !waitingOnWork && (facts.silentMin ?? 0) >= threshold;
    return out(mk("waiting", waitingOnWork ? word : kind === "worker" && isChild ? "Working" : "Waiting", { count: waitingOnWork ? count : null, bar: waitingOnWork ? bar(word) : null }), {
      running: !markerOnly,
    });
  }

  // ================================================================ step 8: unread Done pill, BB's own word, idle
  if (unread) return out(isChild ? mk("done-child", "Done") : mk("done-unread", "Done"));
  if (input.bbWord) {
    const word = BB_WORD_LABELS[input.bbWord.toLowerCase() as keyof typeof BB_WORD_LABELS] ?? input.bbWord;
    return out({ ...IDLE_CARD, word, text: word, tone: BB_TONE[word] ?? null });
  }
  // A worker that has run a turn is never blank (AC-21).
  const ran = hf.turnStartedAt !== null || hf.turnEndedAt !== null || facts.turnStartedAt !== undefined;
  if (kind === "worker" && isChild && ran && input.neverRan !== true) return out(mk("done-child", "Done"));
  return out(IDLE_CARD);
}

/** The card for one thread (LC-4, LC-6). */
export function cardFor(input: CardInput): CardView {
  const card = resolve(input).card;
  if (input.statusAgeMin === undefined || card.text === null || card.pill) return card;
  const now = input.now ?? Date.now();
  return { ...card, timeLabel: formatTimeInStatus(now - input.statusAgeMin * 60_000, now) };
}

/** The memory to store after showing `card` (AC-44, AC-48, AC-49); used by the server. */
export function nextMemory(input: CardInput, card: CardView): SavedMemory {
  const r = resolve(input);
  if (r.reset) return { endWord: null, needsYouAt: null };
  const hf = input.historyFacts ?? foldHistory(input.history ?? [], input.rules === undefined ? defaultRules() : input.rules);
  const cutoff = Math.max(hf.latestOwnerAt ?? -Infinity, hf.clearedAt ?? -Infinity);
  let needsYouAt: number | null = input.saved?.needsYouAt ?? null;
  if (needsYouAt !== null && needsYouAt <= cutoff) needsYouAt = null;
  if (r.isChild) needsYouAt = null;
  else if (needsYouAt === null) {
    if (input.facts?.pending === true) needsYouAt = input.now ?? Date.now();
    else if (r.fileNeedsYouAt !== null) needsYouAt = r.fileNeedsYouAt;
  }
  return { endWord: card.word === "Handing over" ? null : r.endWord, needsYouAt };
}

/** The chime class of a card: "needs-you" | "done" | "none" (LC-9). */
export function chimeClassOf(card: CardView, input: CardInput): "needs-you" | "done" | "none" {
  const r = resolve(input);
  if (r.isChild || card.word === null) return "none";
  if (card.word === "Needs you" || card.word === "Failed") return "needs-you";
  if (card.word === "Done" || card.word === "Stopped" || card.word === "Wrapped" || card.word === "Finalized") {
    // Today's holds: a child still running holds the chime, and a Done the closing did not hand to the Owner is quiet.
    const heldByChild = (input.children ?? []).some((c) => resolve({ ...c, isChild: c.isChild ?? true }).running);
    if (heldByChild) return "none";
    if (card.word === "Done") {
      const rules = input.rules === undefined ? defaultRules() : input.rules;
      const hf = input.historyFacts ?? foldHistory(input.history ?? [], rules);
      const file = typeof input.file === "string" ? parseStatusFile(input.file) : null;
      const fileDone = file?.state === "Done" && file.stateCheck !== "unchecked";
      if (!fileDone && hf.closing !== "done") return "none";
    }
    return "done";
  }
  return "none";
}
