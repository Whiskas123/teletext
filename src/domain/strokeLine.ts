/**
 * The cells a brush stroke passes through between two samples.
 *
 * A drag is not continuous: the browser reports the pointer perhaps sixty times
 * a second, and a hand moving quickly crosses several cells between two of
 * those reports. Painting only the cells that were *reported* therefore draws a
 * dashed line — solid where the hand was slow, gapped where it was fast — which
 * is what a brush that paints on `mouseenter` alone produces.
 *
 * Interpolating between samples fixes it at the source, and fixes it
 * independently of how fast the machine is: a slower browser reports fewer
 * samples, and fewer samples with interpolation is still a solid line. Making
 * the editor faster helps the symptom and cannot cure it, because there is
 * always a hand quick enough to outrun the sampling.
 *
 * Bresenham over the grid's own (column, row), which is exactly the problem it
 * was written for — the cells are pixels.
 */

import { COLS, ROWS, TOTAL_CELLS } from '../types/teletext';

/** Whether `index` addresses a cell on the page. */
function inGrid(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < TOTAL_CELLS;
}

/**
 * Every cell from `from` to `to`, excluding `from` and including `to`.
 *
 * `from` is excluded because it has already been painted — it was the previous
 * sample, or the mousedown. Repainting it would be harmless for a brush and
 * wrong for one that toggles, like the blink brush, where painting a cell twice
 * in one stroke undoes it.
 *
 * Returns just `[to]` when either end is off the grid, so a caller that has
 * lost track of where a stroke started still paints where the pointer actually
 * is, rather than nothing.
 */
export function cellsBetween(from: number, to: number): number[] {
  if (!inGrid(to)) return [];
  // The origin is unknown — a stroke that lost its start still paints where the
  // pointer actually is, rather than nothing.
  if (!inGrid(from)) return [to];
  // The pointer has not left the cell it was already in. Painting again would
  // be harmless for a brush and wrong for the blink brush, which toggles.
  if (from === to) return [];

  let col = from % COLS;
  let row = Math.floor(from / COLS);
  const targetCol = to % COLS;
  const targetRow = Math.floor(to / COLS);

  const stepCol = col < targetCol ? 1 : -1;
  const stepRow = row < targetRow ? 1 : -1;
  const spanCol = Math.abs(targetCol - col);
  const spanRow = Math.abs(targetRow - row);
  let error = spanCol - spanRow;

  const cells: number[] = [];
  // Bounded by the grid's diagonal: the walk moves at least one step in one
  // axis per iteration, so it cannot outlast the distance it has to cover.
  const limit = COLS + ROWS;
  for (let guard = 0; guard < limit; guard += 1) {
    const doubled = error * 2;
    if (doubled > -spanRow) {
      error -= spanRow;
      col += stepCol;
    }
    if (doubled < spanCol) {
      error += spanCol;
      row += stepRow;
    }

    const index = row * COLS + col;
    if (inGrid(index)) cells.push(index);
    if (col === targetCol && row === targetRow) break;
  }

  return cells;
}
