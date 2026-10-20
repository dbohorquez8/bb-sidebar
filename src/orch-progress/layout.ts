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
 * Gap between segments in a bar `widthPx` wide: the full gap while every segment keeps at least `SEGMENT_MIN_PX`,
 * then narrower, then closed, so a dense list gives its room to the segments. The CSS from `barGapCss` computes the
 * same value from the bar's own width, so no measurement runs in script.
 */
export function gapPx(widthPx: number, n: number): number {
  if (n <= 1) return 0;
  return Math.min(SEGMENT_GAP_PX, Math.max(0, (widthPx - n * SEGMENT_MIN_PX) / (n - 1)));
}

/** The `column-gap` expression for `n` segments; `100cqw` is the bar wrapper's width (it is a size container). */
export function barGapCss(n: number): string {
  if (n <= 1) return "0px";
  return `clamp(0px, calc((100cqw - ${n * SEGMENT_MIN_PX}px) / ${n - 1}), ${SEGMENT_GAP_PX}px)`;
}
