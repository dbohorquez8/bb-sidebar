// WS-268 LC-1: constants for the status-file reader. Values are locked by the plan.

export const STATUS_DIR = ".claude/status";
export const MIDTURN_REREAD_MS = 10_000; // D-8 (b)
export const TURN_END_REREAD_MS = 2_000; // D-8 (c), step
export const TURN_END_WINDOW_MS = 14_000; // D-8 (c), last re-read; AC-69a's 15 s chime bound sits above it
export const EVENT_REREAD_MIN_GAP_MS = 2_000; // D-8 (a) and (f)
export const FAILED_REREAD_MS = 10_000; // D-8 (e); must stay ≤ 10 s
export const FILE_READ_TIMEOUT_MS = 4_000; // a read with no answer by then counts as failed for chime settling; a late answer still updates the cache
export const CHIME_FILE_WAIT_MS = 15_000; // AC-69a (AD-13)
export const COMPOSE_POLL_MS = 2_000; // D-8, composer refresh
export const CHECK_THRESHOLD_DEFAULT_MINUTES = 40; // AC-60; re-exported as SILENCE_THRESHOLD_DEFAULT_MINUTES (attention/silence.ts)
