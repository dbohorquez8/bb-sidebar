/** Advance of one 10px monospace character (text-2xs) and a tick's horizontal padding (px-1.5 each side). */
export const CHAR_PX = 6;
export const TICK_PAD_PX = 12;
/** Gap between chained ticks: 1px of background, no border, so neighbours of one status stay distinct. */
export const TICK_GAP_PX = 1;
/** Gap (the same 1px) and floor width once the ticks must narrow; height never changes. */
export const NARROW_GAP_PX = 1;
export const TICK_MIN_PX = 4;
/** Without a measurement (first paint, no layout engine) a list longer than this narrows. */
export const UNMEASURED_CHAIN_MAX = 8;
export const UNMEASURED_NARROW_PX = 6;

/**
 * `chain`: every ticket tick at its natural width, number inside. `narrow`: the last resort for a very
 * long list; ticks share `tickPx` and drop their text, at the same height. `gap` is the space between ticks.
 */
export type RowLayout = { mode: "chain" | "narrow"; tickPx: number | null; gap: number };

/** Natural width of a tick that shows `text`. */
export function tickWidth(text: string): number {
  return text.length * CHAR_PX + TICK_PAD_PX;
}

/**
 * Chained-tick width choice. `texts` is what each ticket tick shows; `available` is the row width left after
 * the first tick. Natural widths win; only when they do not fit do the ticks narrow. A pure function of its
 * inputs, so a refresh with unchanged data returns the same layout.
 */
export function chooseChain(texts: readonly string[], available: number | null): RowLayout {
  const n = texts.length;
  if (available === null || n === 0) {
    return n <= UNMEASURED_CHAIN_MAX
      ? { mode: "chain", tickPx: null, gap: TICK_GAP_PX }
      : { mode: "narrow", tickPx: UNMEASURED_NARROW_PX, gap: NARROW_GAP_PX };
  }
  const natural = texts.reduce((sum, text) => sum + tickWidth(text), 0) + (n - 1) * TICK_GAP_PX;
  if (natural <= available) return { mode: "chain", tickPx: null, gap: TICK_GAP_PX };
  const room = available - (n - 1) * NARROW_GAP_PX;
  const widest = Math.max(...texts.map(tickWidth));
  return { mode: "narrow", tickPx: Math.min(widest, Math.max(TICK_MIN_PX, Math.floor(room / n))), gap: NARROW_GAP_PX };
}
