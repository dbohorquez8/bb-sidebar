// The card the sidebar shows for one thread (WS-268, LC-4 types and LC-7 look table).
// Types only plus the word → look table: the resolver (`cardFor`) lives in card.ts and re-exports this file.

export type Tone = "yellow" | "green" | "red" | "orange" | "white" | "violet" | "muted";
export type IconShape =
  | "spinner"
  | "gear"
  | "ticket"
  | "bell"
  | "check-in-circle"
  | "question-mark-in-circle"
  | "hand-or-shield"
  | "X-in-circle"
  | "clock"
  | "rocket"
  | "moon"
  | "bookmark"
  | "swap-arrows"
  | "flag"
  | "none";
export type BarSegment = "green" | "pulsing" | "empty";

export interface CardView {
  /** The word alone ("Building"); null for an idle card. */
  word: string | null;
  /** "1 / 2" when the card carries a count, else null. */
  count: string | null;
  /** Word and count ("Building 1 / 2"); null for idle. */
  text: string | null;
  tone: Tone | null;
  icon: IconShape;
  pill: boolean;
  /** "1 running" or null. */
  hint: string | null;
  /** The implementer slice bar, one entry per segment; null when the card has none. */
  bar: BarSegment[] | null;
  /** The muted age after the word; null when none is shown. */
  timeLabel: string | null;
}

/** Icon shape → `Icon` name (LC-7). "none" has no glyph. */
export const ICON_OF_SHAPE = {
  spinner: "Loading",
  gear: "Gear",
  ticket: "Ticket",
  bell: "Bell",
  "check-in-circle": "CheckCircle",
  "question-mark-in-circle": "CircleQuestion",
  "hand-or-shield": "Hand",
  "X-in-circle": "CircleX",
  clock: "Clock",
  rocket: "Rocket",
  moon: "Moon",
  bookmark: "Bookmark",
  "swap-arrows": "SwapArrows",
  flag: "Flag",
} as const satisfies Record<Exclude<IconShape, "none">, string>;

export interface Look {
  tone: Tone | null;
  icon: IconShape;
  pill: boolean;
}

export type LookKey =
  | "running"
  | "handing-over"
  | "waiting"
  | "queued-gates"
  | "needs-you"
  | "asking"
  | "approval"
  | "failed"
  | "check"
  | "finalized"
  | "landed"
  | "stopped"
  | "wrapped"
  | "handed-over"
  | "done-child"
  | "done-read"
  | "done-unread"
  | "verified";

/** Word → look (LC-7). BB's own words (Draft, Queued, Planning, Goal) keep today's tone, no icon, no pill. */
export const LOOK: Readonly<Record<LookKey, Look>> = {
  running: { tone: "yellow", icon: "spinner", pill: false },
  "handing-over": { tone: "yellow", icon: "swap-arrows", pill: false },
  waiting: { tone: "green", icon: "gear", pill: false },
  "queued-gates": { tone: "green", icon: "ticket", pill: false },
  "needs-you": { tone: "red", icon: "bell", pill: true },
  asking: { tone: "red", icon: "question-mark-in-circle", pill: false },
  approval: { tone: "red", icon: "hand-or-shield", pill: false },
  failed: { tone: "red", icon: "X-in-circle", pill: false },
  check: { tone: "orange", icon: "clock", pill: false },
  finalized: { tone: "violet", icon: "rocket", pill: false },
  landed: { tone: "white", icon: "flag", pill: false },
  stopped: { tone: "white", icon: "moon", pill: false },
  wrapped: { tone: "white", icon: "bookmark", pill: false },
  "handed-over": { tone: "white", icon: "swap-arrows", pill: false },
  "done-child": { tone: "white", icon: "check-in-circle", pill: false },
  "done-read": { tone: "white", icon: "check-in-circle", pill: false },
  "done-unread": { tone: "white", icon: "check-in-circle", pill: true },
  verified: { tone: "green", icon: "none", pill: false },
};
