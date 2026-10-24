// Locked contract types for the sidebar attention feature (004-sidebar-attention).
// See docs/features/004-sidebar-attention/plan.md § Locked Contracts.

export type AttentionStatus =
  | "needs-you"
  | "check"
  | "failed"
  | "working"
  | "background"
  | "done"
  | "idle";

export type BbWord = "draft" | "queued" | "planning" | "goal";

export type ResolvedStatus =
  | { kind: AttentionStatus }
  | { kind: "bb-word"; word: BbWord };

export type StateRuleKind = "needs-you" | "working" | "background" | "done";

export interface BackgroundWork {
  workers: number;
  commands: number;
  workflows: number;
}

export interface ObservedReply {
  endedAt: number;
}

/**
 * Slice workers' progress on an orchestrator thread (WS-30). `done` is a set of slice
 * numbers; `at` is the latest worker activity for `feature` (the newest feature wins).
 */
export interface SliceProgress {
  feature: string;
  total: number;
  done: number[];
  at: number;
}

export interface ObservedRules {
  /** Active document stamp (rulesDocumentVersion), or null when no document was active. */
  version: string | null;
  status: "needs-you" | "working" | "background" | "done" | null;
  label: {
    text: string;
    tone?: "muted" | "primary" | "success" | "warning" | "danger";
    progress?: "slices";
  } | null;
  /** When the current label was set, by this thread or a child worker; absent when there is no label. */
  labelAt?: number;
}

/** A rule label as the card shows it: finished/total slices appear when known. */
export type RuleLabelView = NonNullable<ObservedRules["label"]> & {
  sliceProgress?: { done: number; total: number };
};

export interface ThreadObservation {
  v: 2;
  threadId: string;
  /**
   * Highest `seq` among rows returned by reads filtered with
   * `types: HISTORY_EVENT_TYPES`; null before the first read. The only reading
   * position kept, and only ever compared with filtered rows (one sequence space).
   */
  cursorSeq: number | null;
  turnStartedAt: number | null; // BB's recorded time, as are all times below
  turnEndedAt: number | null;
  /** Cleared when a turn starts. Holds rule outcomes only — never reply text. */
  reply: ObservedReply | null;
  /** Declarative rule outcome and the rules version that produced it; absent on pre-rules records. */
  rules?: ObservedRules;
  /** When a rule last reset the label; slice workers older than this never count. */
  labelResetAt?: number;
  /** Slice workers' progress; set only on an orchestrator thread, cleared by a label reset. */
  slices?: SliceProgress;
  /** Latest background activity: the thread's own rows, and its child threads' rows. */
  lastActivityAt: number | null;
  /** When the pending question or approval was raised; null when none is pending. */
  interactionAt: number | null;
  /** Server clock time of the last sync with the history. */
  observedAt: number;
}

/** Minimal structural view of an SDK thread event row (`ThreadEventRow`). */
export interface ThreadEventRowLike {
  seq: number;
  createdAt: number;
  type: string;
  data: unknown;
}

export type ObservationEvent =
  /**
   * A message asked for a turn (`client/turn/requested`). `byOwner` is true only for
   * `initiator=user` with no sender thread; `text` is carried only then, is matched against
   * the wake-message patterns, and is never stored (WS-142).
   */
  | { kind: "turn-requested"; at: number; byOwner: boolean; text: string }
  | { kind: "turn-started"; at: number }
  | { kind: "turn-ended"; at: number; finalReply: string | null }
  | { kind: "turn-failed"; at: number }
  | { kind: "step-invoked"; at: number; step: string }
  | { kind: "background-activity"; at: number }
  | { kind: "interaction-raised"; at: number }
  | { kind: "interaction-resolved"; at: number }
  /** The conversation was reset (/clear): sticky label and reply-marker status no longer apply. */
  | { kind: "context-cleared"; at: number }
  | { kind: "cursor"; seq: number }; // highest seq of a filtered batch

export interface TicketMatch {
  id: string;
  source: "title" | "branch";
  titleRest: string | null;
}

export interface AttentionView {
  status: ResolvedStatus;
  /** Status word; null for idle. */
  label: string | null;
  /** Time beside the word; null for idle, draft, queued. */
  timeLabel: string | null;
  /** Epoch ms the shown time counts from; null when no time is shown. */
  since: number | null;
  /** Sticky label from the active rules; shown in place of the status word on Working and Background. */
  ruleLabel: RuleLabelView | null;
  ticket: TicketMatch | null;
  background: BackgroundWork;
  backgroundCount: number;
  /** Text for assistive technology: "Needs you, 6m"; an idle card gives its age. */
  accessibleText: string;
}
