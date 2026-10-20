/** Advance of one 10px monospace character (text-2xs) and a tick's horizontal padding (px-1.5 each side). */
export const CHAR_PX = 6;
export const TICK_PAD_PX = 12;
/** Gap between chained ticks: none, so they form one progress bar. */
export const TICK_GAP_PX = 0;
/** Gap (none, same bar) and floor width once the ticks must narrow; height never changes. */
export const NARROW_GAP_PX = 0;
export const TICK_MIN_PX = 4;
const COUNT_CHAR_PX = 6.6;
/** Space between the first tick, the ticket ticks and the count: the card's gap-1.5. */
export const ROW_GAP_PX = 6;
export const COUNT_GAP_PX = ROW_GAP_PX;
/** Without a measurement (first paint, no layout engine) a list longer than this narrows. */
export const UNMEASURED_CHAIN_MAX = 8;
export const UNMEASURED_NARROW_PX = 6;

/**
 * `chain`: every ticket tick at its natural width, number inside. `narrow`: the last resort for a very
 * long list; ticks share `tickPx` and drop their text, at the same height. `gap` is the space between ticks.
 */
export type RowLayout = { mode: "chain" | "narrow"; tickPx: number | null; gap: number; showCount: boolean };

export function countWidth(counts: { done: number; total: number }): number {
  return `${counts.done} / ${counts.total}`.length * COUNT_CHAR_PX + COUNT_GAP_PX;
}

/** Natural width of a tick that shows `text`. */
export function tickWidth(text: string): number {
  return text.length * CHAR_PX + TICK_PAD_PX;
}

/**
 * Chained-tick width choice. `texts` is what each ticket tick shows; `available` is the row width left after
 * the first tick, the count included. Natural widths with the count win; the count is dropped next; only
 * then do the ticks narrow (and the count is kept only if even the narrowest ticks fit beside it). A pure
 * function of its inputs, so a refresh with unchanged data returns the same layout.
 */
export function chooseChain(texts: readonly string[], available: number | null, counts: { done: number; total: number }): RowLayout {
  const n = texts.length;
  if (available === null || n === 0) {
    return n <= UNMEASURED_CHAIN_MAX
      ? { mode: "chain", tickPx: null, gap: TICK_GAP_PX, showCount: true }
      : { mode: "narrow", tickPx: UNMEASURED_NARROW_PX, gap: NARROW_GAP_PX, showCount: true };
  }
  const natural = texts.reduce((sum, text) => sum + tickWidth(text), 0) + (n - 1) * TICK_GAP_PX;
  const count = countWidth(counts);
  if (natural + count <= available) return { mode: "chain", tickPx: null, gap: TICK_GAP_PX, showCount: true };
  if (natural <= available) return { mode: "chain", tickPx: null, gap: TICK_GAP_PX, showCount: false };
  const floor = n * TICK_MIN_PX + (n - 1) * NARROW_GAP_PX;
  const showCount = floor + count <= available;
  const room = available - (showCount ? count : 0) - (n - 1) * NARROW_GAP_PX;
  const widest = Math.max(...texts.map(tickWidth));
  return { mode: "narrow", tickPx: Math.min(widest, Math.max(TICK_MIN_PX, Math.floor(room / n))), gap: NARROW_GAP_PX, showCount };
}
