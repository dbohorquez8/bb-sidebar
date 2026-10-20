/** Height of the bar, the same as helm's epic bar (0.375rem). */
export const BAR_HEIGHT_PX = 6;
/** Space between segments, one segment per ticket. */
export const SEGMENT_GAP_PX = 2;
/** A segment is at most this wide, so a 3-ticket group stays a small bar. */
export const SEGMENT_MAX_PX = 20;
/** A segment narrows to this floor before the gaps close; past that every ticket keeps a sliver. */
export const SEGMENT_MIN_PX = 3;
/**
 * The bar and its count together take at most this share of the card's content width (a CSS `max-width`,
 * so it follows the card; there is no fixed pixel cap). "Roughly a third", per the Owner.
 */
export const GROUP_MAX_SHARE = 0.33;
/** The thread title keeps at least this much room; the bar narrows only after the title has shrunk to it. */
export const TITLE_MIN_PX = 48;

/** Width the bar takes when the card has room (the group's `GROUP_MAX_SHARE` cap still limits it): segments at their maximum. */
export function barNaturalPx(n: number): number {
  return n <= 0 ? 0 : n * SEGMENT_MAX_PX + (n - 1) * SEGMENT_GAP_PX;
}

/**
 * Whole-pixel layout of `n` segments in a bar `widthPx` wide. The gap is a whole number of pixels, the same for every
 * joint: 2px while every segment keeps its `SEGMENT_MIN_PX` floor, then 1px, then 0px, and it closes for all joints at
 * once. The segment widths are whole pixels too: the room left after the gaps is shared evenly and the remainder is
 * spread one pixel at a time over the leftmost segments, so no two widths differ by more than 1px and the gaps never
 * absorb the rounding. The bar is measured in script (a ResizeObserver) because CSS cannot hand out a remainder.
 */
export function segmentLayout(widthPx: number, n: number): { gap: number; widths: number[] } {
  if (n <= 0) return { gap: 0, widths: [] };
  const width = Math.max(0, Math.floor(widthPx));
  const gap = n <= 1 ? 0 : Math.min(SEGMENT_GAP_PX, Math.max(0, Math.floor((width - n * SEGMENT_MIN_PX) / (n - 1))));
  const room = Math.max(0, width - (n - 1) * gap);
  const base = Math.floor(room / n);
  const extra = room - base * n;
  return { gap, widths: Array.from({ length: n }, (_, index) => Math.min(SEGMENT_MAX_PX, base + (index < extra ? 1 : 0))) };
}
