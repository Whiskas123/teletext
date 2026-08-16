/**
 * The cells a stroke covers between two pointer samples.
 *
 * The bug this exists to prevent is visible and specific: a line drawn quickly
 * came out dashed, because only the cells the browser happened to report were
 * painted. So the properties that matter are that the walk is *connected* —
 * every step touches the previous one — and that it actually arrives.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cellsBetween } from './strokeLine';
import { COLS, ROWS, TOTAL_CELLS } from '../types/teletext';

const anyCell = fc.integer({ min: 0, max: TOTAL_CELLS - 1 });

const at = (index: number) => ({ col: index % COLS, row: Math.floor(index / COLS) });

describe('cellsBetween', () => {
  it('fills a fast horizontal drag, which is what came out dashed', () => {
    // Row 2, columns 3 to 8: the pointer reported 3 and 8, and everything
    // between has to be painted or the line has holes in it.
    const from = 2 * COLS + 3;
    const to = 2 * COLS + 8;
    expect(cellsBetween(from, to)).toEqual([
      from + 1,
      from + 2,
      from + 3,
      from + 4,
      to,
    ]);
  });

  it('leaves out where it started and includes where it arrived', () => {
    // The start was painted by the sample before this one. Repainting it would
    // be harmless for a brush and wrong for the blink brush, which toggles.
    fc.assert(
      fc.property(anyCell, anyCell, (from, to) => {
        const cells = cellsBetween(from, to);
        expect(cells).not.toContain(from);
        if (from !== to) expect(cells[cells.length - 1]).toBe(to);
      }),
    );
  });

  it('never leaves a gap: every cell touches the one before it', () => {
    fc.assert(
      fc.property(anyCell, anyCell, (from, to) => {
        const walk = [from, ...cellsBetween(from, to)];
        for (let i = 1; i < walk.length; i += 1) {
          const a = at(walk[i - 1]);
          const b = at(walk[i]);
          expect(Math.abs(a.col - b.col)).toBeLessThanOrEqual(1);
          expect(Math.abs(a.row - b.row)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it('stays on the grid, and terminates', () => {
    fc.assert(
      fc.property(anyCell, anyCell, (from, to) => {
        const cells = cellsBetween(from, to);
        expect(cells.length).toBeLessThanOrEqual(COLS + ROWS);
        for (const index of cells) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(TOTAL_CELLS);
        }
      }),
    );
  });

  it('paints the one cell when a stroke has not moved', () => {
    expect(cellsBetween(500, 500)).toEqual([]);
  });

  it('still paints where the pointer is when the start is unknown', () => {
    // A stroke whose origin was lost should not swallow the sample it has.
    expect(cellsBetween(-1, 500)).toEqual([500]);
    expect(cellsBetween(Number.NaN, 500)).toEqual([500]);
  });

  it('paints nothing for a destination off the grid', () => {
    expect(cellsBetween(100, TOTAL_CELLS)).toEqual([]);
    expect(cellsBetween(100, -5)).toEqual([]);
  });
});
