/** Height of the bar, the same as helm's epic bar (0.375rem). */
export const BAR_HEIGHT_PX = 6;
/** Space between segments, one segment per ticket. */
export const SEGMENT_GAP_PX = 2;
/** A segment is at most this wide, so a 3-ticket group stays a small bar. */
export const SEGMENT_MAX_PX = 20;
/** A segment narrows to this floor before the bar stops following the ticket count. */
export const SEGMENT_MIN_PX = 3;
/** The bar never grows past this, however many tickets there are. */
export const BAR_MAX_PX = 140;
/** The thread title keeps at least this much room; the bar narrows only after the title has shrunk to it. */
export const TITLE_MIN_PX = 48;

/**
 * Width budget of the bar for `n` tickets. `naturalPx` is the width it takes when the card has room;
 * `minPx` is the least it narrows to (the segments sharing the width down to the floor). Past the point where
 * the floor no longer fits under `BAR_MAX_PX`, the gap closes (`gap` 0) so every ticket still gets a sliver.
 * A pure function of the ticket count, so a refresh with unchanged data keeps the layout.
 */
export type BarLayout = { gap: number; naturalPx: number; minPx: number };

export function barLayout(n: number): BarLayout {
  if (n <= 0) return { gap: SEGMENT_GAP_PX, naturalPx: 0, minPx: 0 };
  const dense = n * SEGMENT_MIN_PX + (n - 1) * SEGMENT_GAP_PX > BAR_MAX_PX;
  const gap = dense ? 0 : SEGMENT_GAP_PX;
  const width = (segment: number) => n * segment + (n - 1) * gap;
  return {
    gap,
    naturalPx: Math.min(width(SEGMENT_MAX_PX), BAR_MAX_PX),
    minPx: Math.min(width(SEGMENT_MIN_PX), BAR_MAX_PX),
  };
}
