/**
 * Blanking the page numbers a screen points at.
 *
 * Captures are full of "Notícias ..... 120" and "Ajuda: pág 151". The archive
 * was renumbered on import, so those numbers send a reader to the wrong page or
 * to none. A page number on teletext is three digits, so that is what goes:
 * every run of exactly three digits, on any row. Longer runs (years, phone and
 * SMS numbers) and shorter ones (1/20, 3€) stay.
 *
 * Known ceiling: a three-digit number that is not a page — "100 pontos", a
 * phone number split as "707 20 30 40" — goes too. Archive screens can be put
 * back by re-publishing them from the archive.
 */

import { COLS, ROWS, type TeletextPage } from '../types/teletext';
import { normalizePage } from './pageOps';

const isDigit = (cell: TeletextPage[number]) => cell.graphics == null && /^[0-9]$/.test(cell.char);

/**
 * A copy of `page` with every three-digit run replaced by spaces in the same
 * colours, and how many runs went. `keepRow` is left as it is — a saved bottom
 * bar, whose numbers were set by hand and are right.
 */
export function stripPageNumbers(
  page: TeletextPage,
  keepRow: number | null = null,
): { page: TeletextPage; removed: number } {
  const result = normalizePage(page).map((cell) => ({ ...cell }));
  let removed = 0;
  for (let row = 0; row < ROWS; row += 1) {
    if (row === keepRow) continue;
    let col = 0;
    while (col < COLS) {
      if (!isDigit(result[row * COLS + col])) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < COLS && isDigit(result[row * COLS + col])) col += 1;
      if (col - start !== 3) continue;
      for (let c = start; c < col; c += 1) result[row * COLS + c].char = ' ';
      removed += 1;
    }
  }
  return { page: result, removed };
}
