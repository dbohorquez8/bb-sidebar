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

export interface StateMarkerRule {
  marker: string;
  kind: StateRuleKind;
}

export interface WorkflowStage {
  id: string;
  label: string;
  /** "slices": the stage shows finished/total slices of the build, when known. */
  progress?: "slices";
}

export interface WorkflowStepRule {
  step: string;
  stageId: string;
}

export type AttentionPreset =
  | { id: string; label: string; kind: "state-markers"; rules: readonly StateMarkerRule[] }
  | {
      id: string;
      label: string;
      kind: "workflow";
      workflow: { id: string; label: string; stages: readonly WorkflowStage[] };
      rules: readonly WorkflowStepRule[];
      /** Steps that start the work over: invoking one clears the thread's stage. */
      resetSteps?: readonly string[];
    };

export interface BackgroundWork {
  workers: number;
  commands: number;
  workflows: number;
}

/** 0-based line index. */
export interface StateLineMatch {
  kind: StateRuleKind;
  line: number;
}

export interface ObservedReply {
  endedAt: number;
  /** One entry per state-marker preset whose rules matched; key = preset id. */
  matches: Readonly<Record<string, StateLineMatch>>;
}

export interface ObservedStep {
  stageId: string;
  at: number;
}

/** Slice workers' progress on an orchestrator thread (WS-30). `done` is a set of slice numbers. */
export interface SliceProgress {
  feature: string;
  total: number;
  done: number[];
}

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
  /** Latest mapped step per workflow preset id. */
  steps: Readonly<Record<string, ObservedStep>>;
  /** When the workflow was last reset, per workflow preset id; older steps never count. */
  stepResets?: Readonly<Record<string, number>>;
  /** Slice workers' progress; set only on an orchestrator thread, cleared by a workflow reset. */
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
  | { kind: "turn-started"; at: number }
  | { kind: "turn-ended"; at: number; finalReply: string | null }
  | { kind: "turn-failed"; at: number }
  | { kind: "step-invoked"; at: number; step: string }
  | { kind: "background-activity"; at: number }
  | { kind: "interaction-raised"; at: number }
  | { kind: "interaction-resolved"; at: number }
  | { kind: "cursor"; seq: number }; // highest seq of a filtered batch

export interface StageView {
  presetId: string;
  workflowLabel: string; // the workflow's display name, from its preset
  stageLabel: string; // "Spec", "Validation plan", "Loop"
  position: number; // 1-based
  total: number;
  showMarks: boolean; // total > 1
  /** Finished/total slices; only on a stage marked `progress: "slices"` with a known total. */
  sliceProgress?: { done: number; total: number };
}

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
  stage: StageView | null;
  ticket: TicketMatch | null;
  background: BackgroundWork;
  backgroundCount: number;
  /** Text for assistive technology: "Needs you, 6m"; an idle card gives its age. */
  accessibleText: string;
}
