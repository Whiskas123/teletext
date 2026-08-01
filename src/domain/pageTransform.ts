/**
 * Whole-page edits applied when publishing an archive capture.
 *
 * A capture is not always publishable exactly as it was decoded. The two
 * adjustments here are the ones the archive actually needs, and both are pure
 * so the admin screen can preview precisely what will be published.
 */

import { COLS, ROWS, TOTAL_CELLS, createEmptyPage, type TeletextPage } from '../types/teletext';
import { normalizePage } from './pageOps';

/**
 * Move every row down by one, dropping the last and leaving row 0 blank.
 *
 * Some captures carry a four-colour menu strip on their bottom row that
 * duplicates the one being applied on publish, and some sit one row higher than
 * the rest of the archive because their renderer had no header row to give up.
 * Shifting down fixes both at once: the duplicate strip falls off the bottom,
 * and everything else lands where the other pages have it.
 *
 * It is lossy by design — the last row is discarded, which is the point — so it
 * is opt-in per publication and recorded on the row, never applied silently.
 */
export function shiftPageDown(page: TeletextPage): TeletextPage {
  const source = normalizePage(page);
  const result = createEmptyPage();

  // Row 0 is left as the empty row `createEmptyPage` already gave us; the last
  // source row has nowhere to go and is dropped.
  for (let row = 0; row < ROWS - 1; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      result[(row + 1) * COLS + col] = { ...source[row * COLS + col] };
    }
  }

  return result;
}

/** Whether a page's last row holds anything, i.e. whether shifting would lose it. */
export function lastRowHasContent(page: TeletextPage): boolean {
  const source = normalizePage(page);
  for (let i = TOTAL_CELLS - COLS; i < TOTAL_CELLS; i += 1) {
    const cell = source[i];
    if (cell.char !== ' ' || cell.graphics != null) return true;
  }
  return false;
}
