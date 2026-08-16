/**
 * Keeping the cells that did not change.
 *
 * `normalizePage` builds a page out of the stored cell map, and it builds it
 * *fresh* — 960 new objects every time, even when one character was typed. For
 * the store that is right: normalising is how a page from an untrusted source
 * becomes a page. For React it is ruinous, because a new object is a changed
 * prop, so every cell on the grid re-renders for every keystroke of every
 * editor, and `React.memo` on a cell can never help.
 *
 * This is the reconciliation between the two. The freshly normalised page is
 * correct; where a cell is *equal* to the one already on screen, the one
 * already on screen is kept, so its identity survives and the cell it belongs
 * to renders once and then stops.
 *
 * A shallow comparison of six fields across 960 cells is a few tens of
 * microseconds. The 955 React elements it avoids building and diffing are not.
 */

import type { Cell, TeletextPage } from '../types/teletext';

/** Whether two cells would render identically. */
function sameCell(a: Cell, b: Cell): boolean {
  if (a === b) return true;
  if (
    a.char !== b.char ||
    a.fg !== b.fg ||
    a.bg !== b.bg ||
    (a.graphics ?? null) !== (b.graphics ?? null) ||
    (a.blink ?? false) !== (b.blink ?? false) ||
    (a.doubleHeight ?? false) !== (b.doubleHeight ?? false)
  ) {
    return false;
  }

  // Only a graphics cell has sixel colours, and only then are they worth
  // comparing — six string reads per cell across a whole page of text would be
  // most of the cost of this function for nothing.
  const aColors = a.graphicsColors;
  const bColors = b.graphicsColors;
  if (aColors === bColors) return true;
  if (aColors == null || bColors == null) return false;
  for (let i = 0; i < 6; i += 1) {
    if (aColors[i] !== bColors[i]) return false;
  }
  return true;
}

/**
 * `next`, with every unchanged cell replaced by the object `previous` had.
 *
 * Returns `previous` itself when nothing changed at all, so a render triggered
 * by an edit to a *different* page — which is every edit by every other person,
 * since the channel is the whole document — does not even produce a new array.
 */
export function reuseUnchangedCells(
  next: TeletextPage,
  previous: TeletextPage | null,
): TeletextPage {
  if (previous == null || previous.length !== next.length) return next;

  let changed = false;
  const result: TeletextPage = new Array<Cell>(next.length);
  for (let i = 0; i < next.length; i += 1) {
    if (sameCell(next[i], previous[i])) {
      result[i] = previous[i];
    } else {
      result[i] = next[i];
      changed = true;
    }
  }

  return changed ? result : previous;
}
