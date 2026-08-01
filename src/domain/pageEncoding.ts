/**
 * Converting between the two shapes a page is stored in.
 *
 * playhtml holds a page as a {@link PageCellMap} — an object keyed by cell index
 * — because that is what makes concurrent edits merge: two people editing
 * different cells write different keys and both survive, while two editing the
 * same cell converge last-writer-wins. That shape exists to serve the CRDT.
 *
 * The database holds the positional {@link TeletextPage} array instead. Nothing
 * merges rows in Postgres, so the map's only advantage does not apply, and on
 * real pages the array gzips about 40% smaller (1.3 KB against 2.2 KB) because
 * it spends no bytes repeating index keys.
 *
 * So every crossing between the two stores passes through here. Both directions
 * go via `normalizePage`, which is the single definition of what a well-formed
 * page is: exactly {@link TOTAL_CELLS} cells, each valid, missing entries filled
 * with the empty cell. A page arriving from either store is therefore repaired
 * rather than trusted, which matters because both are writable by clients.
 */

import { normalizePage } from './pageOps';
import { TOTAL_CELLS, type Cell, type TeletextPage } from '../types/teletext';

/** A page as playhtml stores it: cell index -> cell, entries possibly missing. */
export type PageCellMap = Record<number, Cell>;

/**
 * The positional array form, for storing in the database.
 *
 * Accepts anything playhtml might hold — a sparse map, an absent value, a
 * malformed one — and always yields a complete page.
 */
export function pageToArray(stored: unknown): TeletextPage {
  return normalizePage(stored);
}

/**
 * The index-keyed map form, for writing into playhtml.
 *
 * Every index is written explicitly rather than leaving empty cells absent: an
 * import replaces a page, so a cell the new content leaves blank has to end up
 * blank, which a sparse write over an existing page would not achieve.
 */
export function pageToCellMap(page: unknown): PageCellMap {
  const normalized = normalizePage(page);
  const map: PageCellMap = {};
  for (let index = 0; index < TOTAL_CELLS; index += 1) {
    map[index] = { ...normalized[index] };
  }
  return map;
}

/**
 * Whether `value` is already a complete page array, needing no repair.
 *
 * Used to tell a page that round-tripped intact from one that `normalizePage`
 * had to fill in — the snapshot endpoint rejects the latter rather than storing
 * a page it silently altered.
 */
export function isCompletePageArray(value: unknown): value is TeletextPage {
  if (!Array.isArray(value) || value.length !== TOTAL_CELLS) return false;
  return value.every(
    (cell) => cell != null && typeof cell === 'object' && typeof cell.char === 'string',
  );
}
