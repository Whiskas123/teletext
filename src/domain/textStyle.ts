/**
 * Recently used text styles for the teletext editor.
 *
 * The block and pixel brushes have had a recent-brushes strip for a while, and
 * typing needs the same thing for the same reason: a page is built out of a
 * handful of colour pairs used over and over — yellow on black for a heading,
 * white on blue for a strip — and rebuilding one from two 4×4 palettes every time
 * you switch back is the slowest part of writing a page.
 *
 * A style is the whole of what typing applies to a cell: both colours *and*
 * double height, since that is as much part of "how this heading looks" as the
 * colours are, and a heading recalled without it is not the heading.
 *
 * Pure and framework-free; the ordering rules are shared with the brush strip
 * (see `recentList.ts`).
 */

import { recordRecent, stepRecent, type RecentList } from './recentList';
import type { TeletextColor } from '../types/teletext';

/** What typing puts on a cell. */
export interface TextStyle {
  fg: TeletextColor;
  bg: TeletextColor;
  doubleHeight: boolean;
}

/** How many recent styles are kept. Older entries fall off the end. */
export const TEXT_STYLE_HISTORY_MAX = 8;

export type TextStyleHistoryState = RecentList<TextStyle>;

/** Structural equality: two styles that would type identically. */
export function textStylesEqual(a: TextStyle, b: TextStyle): boolean {
  return (
    a.fg === b.fg && a.bg === b.bg && a.doubleHeight === b.doubleHeight
  );
}

/** A stable key for React lists / lookups. */
export function textStyleKey(style: TextStyle): string {
  return `${style.fg}-on-${style.bg}${style.doubleHeight ? '-dh' : ''}`;
}

/** How a style reads in a tooltip. */
export function describeTextStyle(style: TextStyle): string {
  return `${style.fg} on ${style.bg}${style.doubleHeight ? ', double height' : ''}`;
}

/**
 * Whether a style is worth remembering.
 *
 * Foreground the same as background is invisible — a cell typed that way shows
 * nothing, so it is almost always a mistake mid-adjustment rather than a style
 * anyone means to come back to. Keeping it would push a real style off the end of
 * the list.
 */
export function isRecordableTextStyle(style: TextStyle): boolean {
  return style.fg !== style.bg;
}

/**
 * Record a style that was just typed with. Returns `state` itself when the
 * strip would not change, so typing does not re-render the editor per keystroke
 * (see {@link recordRecent}).
 */
export function recordTextStyle(
  state: TextStyleHistoryState,
  style: TextStyle,
): TextStyleHistoryState {
  return recordRecent(state, style, textStylesEqual, TEXT_STYLE_HISTORY_MAX);
}

/** Move the cursor by `delta` (negative = towards more recent). */
export function stepTextStyle(
  history: readonly TextStyle[],
  index: number,
  delta: number,
): number {
  return stepRecent(history, index, delta);
}
