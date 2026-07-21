// Feature: collaborative-teletext-rooms, Property 18: A cell edit preserves size and all other cells
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyCellEdit } from './cellEdit';
import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type TeletextColor,
} from '../types/teletext';

/**
 * Property 18: A cell edit preserves size and all other cells.
 *
 * For any 960-cell page, index `i` in 0..959, and valid cell value, applying
 * the edit yields a page of exactly 960 cells in which every cell except index
 * `i` is unchanged and index `i` holds the new value. The input page is never
 * mutated.
 *
 * **Validates: Requirements 6.1, 6.4, 6.5**
 */

const colorArb: fc.Arbitrary<TeletextColor> = fc.constantFrom(
  ...(TELETEXT_COLORS as readonly TeletextColor[]),
);

/**
 * A valid cell: string `char`, valid `fg`/`bg`, optional `graphics` in 0..63,
 * optional blink. Constrained to the valid cell space so `applyCellEdit`
 * always applies the edit (never a no-op).
 */
const validCellArb: fc.Arbitrary<Cell> = fc.record({
  char: fc.string({ minLength: 1, maxLength: 1 }),
  fg: colorArb,
  bg: colorArb,
  graphics: fc.option(fc.integer({ min: 0, max: 63 }), { nil: null }),
  blink: fc.boolean(),
});

/** A full valid page of exactly 960 valid cells. */
const validPageArb: fc.Arbitrary<Cell[]> = fc.array(validCellArb, {
  minLength: TOTAL_CELLS,
  maxLength: TOTAL_CELLS,
});

/** Any valid cell index within the page. */
const indexArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: TOTAL_CELLS - 1,
});

describe('Property 18: A cell edit preserves size and all other cells', () => {
  it('preserves size, sets the edited cell, and leaves all other cells unchanged', () => {
    fc.assert(
      fc.property(validPageArb, indexArb, validCellArb, (page, i, cell) => {
        // Snapshot the original page (deep) to detect mutation of the input.
        const before = page.map((c) => ({ ...c }));

        const result = applyCellEdit(page, i, cell);

        // Size invariant: exactly 960 cells (Req 6.4).
        expect(result).toHaveLength(TOTAL_CELLS);

        // The edited cell holds the new value (Req 6.1).
        expect(result[i]).toEqual(cell);

        // Every other cell is unchanged (Req 6.5).
        for (let j = 0; j < TOTAL_CELLS; j += 1) {
          if (j !== i) {
            expect(result[j]).toEqual(before[j]);
          }
        }

        // The input page must not be mutated.
        expect(page).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});
