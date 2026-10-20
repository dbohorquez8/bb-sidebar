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
 * Whole-pixel layout of `n` equal segments in a bar of at most `widthPx`. Every segment has the same integer width `segment`
 * and every joint has the same integer `gap`, so nothing can look uneven. The gap is the largest of 2, 1, 0 px that still
 * lets every segment keep its `SEGMENT_MIN_PX` floor (it closes for all joints at once); the segment is then as wide as the
 * room allows, up to `SEGMENT_MAX_PX`. The bar's `total` is n * segment + (n - 1) * gap, which may be a few pixels short of
 * `widthPx`: a slightly shorter bar is preferred to unequal segments. The bar is measured in script (a ResizeObserver)
 * because CSS cannot hand out whole-pixel widths. Only when the room is under 1px per ticket (a huge list) do the segments
 * share it as equal fractions of a pixel, so every ticket still keeps a sliver.
 */
export function segmentLayout(widthPx: number, n: number): { gap: number; segment: number; total: number } {
  if (n <= 0) return { gap: 0, segment: 0, total: 0 };
  const width = Math.max(0, Math.floor(widthPx));
  if (width < n) return { gap: 0, segment: width / n, total: width };
  const fit = (gap: number) => Math.min(SEGMENT_MAX_PX, Math.floor((width - (n - 1) * gap) / n));
  const gap = n <= 1 ? 0 : [SEGMENT_GAP_PX, 1, 0].find((candidate) => candidate === 0 || fit(candidate) >= SEGMENT_MIN_PX) ?? 0;
  const segment = Math.max(0, fit(gap));
  return { gap, segment, total: n * segment + (n - 1) * gap };
}
