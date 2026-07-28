/**
 * Cell edit domain logic for Collaborative Teletext Rooms.
 *
 * A Teletext_Page is an array of exactly {@link TOTAL_CELLS} (960) `Cell`
 * objects. Members edit individual cells collaboratively; this module provides
 * the pure, framework-free rules that (a) decide whether a candidate cell is a
 * valid edit and (b) apply a single cell edit while preserving the page's size
 * and every other cell.
 *
 * Keeping this logic free of React and playhtml lets it be exhaustively
 * property-tested (Properties 17 and 18) without a live server.
 *
 * _Requirements: 6.1, 6.4, 6.5, 6.7_
 */

import {
  type Cell,
  type TeletextPage,
  SIXEL_MAX,
  TOTAL_CELLS,
} from '../types/teletext';

/** Lowest valid `graphics` (sixel) value. */
const SIXEL_MIN = 0;

/**
 * A fresh empty cell, used to pad a page up to {@link TOTAL_CELLS} when a
 * malformed page shorter than 960 cells is passed in. Mirrors the empty-cell
 * definition in `src/types/teletext.ts`.
 */
function emptyCell(): Cell {
  return { char: ' ', fg: 'white', bg: 'black', graphics: null };
}

/**
 * Validate a candidate cell edit.
 *
 * Returns `true` iff the cell's `char`, `fg`, and `bg` fields are defined and
 * its `graphics` value is either unset (`null`/`undefined`) or an integer
 * within the inclusive range {@link SIXEL_MIN}..{@link SIXEL_MAX} (0..63);
 * otherwise returns `false`. Total: never throws for any input. (`blink` and
 * `doubleHeight`, like `graphics`, are optional flags this check does not
 * constrain beyond their presence.)
 *
 * _Requirements: 6.7_
 */
export function isValidCell(cell: Cell): boolean {
  if (cell == null || typeof cell !== 'object') {
    return false;
  }

  const { char, fg, bg, graphics } = cell;
  if (char == null || fg == null || bg == null) {
    return false;
  }

  // `graphics` is optional: unset means "no block graphics" and is valid.
  if (graphics == null) {
    return true;
  }

  return (
    Number.isInteger(graphics) &&
    graphics >= SIXEL_MIN &&
    graphics <= SIXEL_MAX
  );
}

/**
 * Return a fresh copy of `page` guaranteed to contain exactly
 * {@link TOTAL_CELLS} cells: existing cells are shallow-copied (so callers can
 * never mutate the input), extra cells are dropped, and missing cells are
 * filled with empty cells. For an already-valid 960-cell page this is simply a
 * per-cell clone that leaves every cell's value unchanged.
 */
function cloneToSize(page: TeletextPage): TeletextPage {
  const cells = Array.isArray(page) ? page : [];
  const result: TeletextPage = new Array(TOTAL_CELLS);
  for (let i = 0; i < TOTAL_CELLS; i += 1) {
    const cell = cells[i];
    result[i] = cell != null ? { ...cell } : emptyCell();
  }
  return result;
}

/**
 * Apply a single cell edit to a page, returning a new page (the input is never
 * mutated).
 *
 * The edit is a no-op — an equivalent 960-cell page is returned — when the
 * candidate `cell` is invalid (see {@link isValidCell}) or `index` falls
 * outside the inclusive range 0..959. Otherwise the cell at `index` is set to
 * the new value. In every case the returned page contains exactly
 * {@link TOTAL_CELLS} (960) cells and every cell other than `index` retains its
 * original value.
 *
 * _Requirements: 6.1, 6.4, 6.5, 6.7_
 */
export function applyCellEdit(
  page: TeletextPage,
  index: number,
  cell: Cell,
): TeletextPage {
  const result = cloneToSize(page);

  const indexInRange =
    Number.isInteger(index) && index >= 0 && index < TOTAL_CELLS;
  if (!indexInRange || !isValidCell(cell)) {
    // No-op: return the equivalent, size-normalized page unchanged.
    return result;
  }

  result[index] = { ...cell };
  return result;
}
