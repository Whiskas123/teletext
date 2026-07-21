// Feature: collaborative-teletext-rooms, Property 17: Cell edit validation rejects malformed cells as a no-op
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isValidCell, applyCellEdit } from './cellEdit';
import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  SIXEL_MAX,
  type Cell,
  type TeletextColor,
} from '../types/teletext';

/**
 * Property 17: Cell edit validation rejects malformed cells as a no-op.
 *
 * For any candidate cell, `isValidCell` returns true iff its `char`, `fg`, and
 * `bg` fields are defined and its `graphics` value is either unset or within 0
 * to 63; applying an invalid edit is a no-op that retains the cell's current
 * value.
 *
 * **Validates: Requirements 6.7**
 */

const colorArb: fc.Arbitrary<TeletextColor> = fc.constantFrom(
  ...(TELETEXT_COLORS as readonly TeletextColor[]),
);

/**
 * Independent oracle for validity, derived directly from the acceptance
 * criteria (NOT from the implementation): char/fg/bg defined and graphics
 * unset (null/undefined) or an integer within 0..SIXEL_MAX.
 */
function oracleIsValid(cell: unknown): boolean {
  if (cell == null || typeof cell !== 'object') {
    return false;
  }
  const c = cell as Record<string, unknown>;
  if (c.char == null || c.fg == null || c.bg == null) {
    return false;
  }
  const g = c.graphics;
  if (g == null) {
    return true;
  }
  return typeof g === 'number' && Number.isInteger(g) && g >= 0 && g <= SIXEL_MAX;
}

/** A well-formed, valid cell. */
const validCellArb: fc.Arbitrary<Cell> = fc.record({
  char: fc.string({ minLength: 1, maxLength: 1 }),
  fg: colorArb,
  bg: colorArb,
  graphics: fc.option(fc.integer({ min: 0, max: SIXEL_MAX }), { nil: null }),
});

/**
 * Invalid cell-like values covering the failure modes:
 * - missing/undefined/null char, fg, or bg
 * - graphics out of range: negative, > SIXEL_MAX, or non-integer
 */
const invalidCellArb: fc.Arbitrary<Cell> = fc.oneof(
  // Missing/undefined/null char.
  fc.record({
    char: fc.constantFrom(undefined, null),
    fg: colorArb,
    bg: colorArb,
  }),
  // Missing/undefined/null fg.
  fc.record({
    char: fc.string({ minLength: 1, maxLength: 1 }),
    fg: fc.constantFrom(undefined, null),
    bg: colorArb,
  }),
  // Missing/undefined/null bg.
  fc.record({
    char: fc.string({ minLength: 1, maxLength: 1 }),
    fg: colorArb,
    bg: fc.constantFrom(undefined, null),
  }),
  // graphics out of 0..63: negative or above max.
  fc.record({
    char: fc.string({ minLength: 1, maxLength: 1 }),
    fg: colorArb,
    bg: colorArb,
    graphics: fc.oneof(
      fc.integer({ min: -1000, max: -1 }),
      fc.integer({ min: SIXEL_MAX + 1, max: 100000 }),
    ),
  }),
  // graphics non-integer (fractional or NaN).
  fc.record({
    char: fc.string({ minLength: 1, maxLength: 1 }),
    fg: colorArb,
    bg: colorArb,
    graphics: fc
      .double({ min: 0, max: SIXEL_MAX, noNaN: false })
      .filter((n) => !Number.isInteger(n)),
  }),
) as fc.Arbitrary<Cell>;

/** A full valid page of exactly 960 valid cells. */
const validPageArb: fc.Arbitrary<Cell[]> = fc.array(validCellArb, {
  minLength: TOTAL_CELLS,
  maxLength: TOTAL_CELLS,
});

describe('Property 17: Cell edit validation rejects malformed cells as a no-op', () => {
  it('isValidCell matches an independent oracle for valid and invalid cells', () => {
    fc.assert(
      fc.property(fc.oneof(validCellArb, invalidCellArb), (cell) => {
        expect(isValidCell(cell)).toBe(oracleIsValid(cell));
      }),
      { numRuns: 200 },
    );
  });

  it('applying an invalid edit is a no-op that retains the cell and page size', () => {
    fc.assert(
      fc.property(
        validPageArb,
        fc.integer({ min: 0, max: TOTAL_CELLS - 1 }),
        invalidCellArb,
        (page, index, invalidCell) => {
          // Precondition: the generated candidate really is invalid.
          expect(isValidCell(invalidCell)).toBe(false);

          const originalCell = page[index];
          const result = applyCellEdit(page, index, invalidCell);

          // Still exactly 960 cells.
          expect(result).toHaveLength(TOTAL_CELLS);

          // No-op: the targeted cell retains its current value.
          expect(result[index]).toEqual(originalCell);

          // The whole page is unchanged.
          expect(result).toEqual(page);
        },
      ),
      { numRuns: 100 },
    );
  });
});
