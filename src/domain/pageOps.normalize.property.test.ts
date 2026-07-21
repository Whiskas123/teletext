// Feature: collaborative-teletext-rooms, Property 20: Page normalization always yields 960 valid cells and is identity on valid pages
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizePage } from './pageOps';
import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type TeletextColor,
} from '../types/teletext';

/**
 * Property 20: Page normalization always yields 960 valid cells and is identity
 * on valid pages.
 *
 * For any input value, `normalizePage` returns a page of exactly 960 cells each
 * with defined `char`, `fg`, and `bg` (missing or malformed cells become empty
 * cells); and for any already-valid 960-cell page, `normalizePage` returns an
 * equal page.
 *
 * **Validates: Requirements 7.4, 7.7**
 */

const colorArb: fc.Arbitrary<TeletextColor> = fc.constantFrom(
  ...(TELETEXT_COLORS as readonly TeletextColor[]),
);

/** Whether a value is one of the valid teletext colors. */
function isTeletextColor(value: unknown): value is TeletextColor {
  return (
    typeof value === 'string' &&
    (TELETEXT_COLORS as readonly string[]).includes(value)
  );
}

/**
 * A valid cell: string `char`, valid `fg`/`bg`, optional `graphics` in 0..63,
 * optional blink. Kept minimal so it round-trips through `normalizePage`
 * unchanged (identity).
 */
const validCellArb: fc.Arbitrary<Cell> = fc.record(
  {
    char: fc.string({ minLength: 1, maxLength: 1 }),
    fg: colorArb,
    bg: colorArb,
    graphics: fc.option(fc.integer({ min: 0, max: 63 }), { nil: null }),
  },
);

/** A full valid page of exactly 960 valid cells. */
const validPageArb: fc.Arbitrary<Cell[]> = fc.array(validCellArb, {
  minLength: TOTAL_CELLS,
  maxLength: TOTAL_CELLS,
});

/**
 * Arbitrary junk cell-ish values: garbage that should collapse to empty cells.
 */
const junkCellArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.array(fc.anything({ maxDepth: 2, maxKeys: 5 }), { maxLength: 3 }),
  // Partial / malformed cell-like objects (missing or bad fields).
  fc.record({
    char: fc.oneof(fc.integer(), fc.constant(undefined), fc.string()),
    fg: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
    bg: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
    graphics: fc.oneof(fc.integer({ min: 100, max: 500 }), fc.string()),
  }),
);

/** Top-level arbitrary junk inputs for normalizePage. */
const junkInputArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.double(),
  fc.string(),
  fc.boolean(),
  // Arrays of garbage / partial cells (positional-array shape).
  fc.array(junkCellArb, { maxLength: 50 }),
  // Object / map shape keyed by arbitrary keys with garbage values.
  fc.dictionary(fc.string(), junkCellArb, { maxKeys: 20 }),
  // Fully arbitrary values. Bounded in depth/breadth so generation stays cheap
  // while still exercising deeply-nested junk; the size does not affect the
  // property (normalizePage always yields 960 valid cells regardless).
  fc.anything({ maxDepth: 2, maxKeys: 5 }),
);

describe('Property 20: Page normalization yields 960 valid cells and is identity on valid pages', () => {
  it('always returns exactly 960 cells with defined char/fg/bg for any junk input', () => {
    fc.assert(
      fc.property(junkInputArb, (input) => {
        const page = normalizePage(input);

        // Exactly 960 cells (Req 7.4, 7.7).
        expect(page).toHaveLength(TOTAL_CELLS);

        // Every cell has a string char and valid fg/bg teletext colors.
        for (const cell of page) {
          expect(typeof cell.char).toBe('string');
          expect(isTeletextColor(cell.fg)).toBe(true);
          expect(isTeletextColor(cell.bg)).toBe(true);
          // graphics, when present, is null or an integer 0..63.
          if (cell.graphics !== null && cell.graphics !== undefined) {
            expect(Number.isInteger(cell.graphics)).toBe(true);
            expect(cell.graphics).toBeGreaterThanOrEqual(0);
            expect(cell.graphics).toBeLessThanOrEqual(63);
          }
        }
      }),
      { numRuns: 200 },
    );
  }, 15000);

  it('is the identity on already-valid 960-cell pages', () => {
    fc.assert(
      fc.property(validPageArb, (page) => {
        const normalized = normalizePage(page);

        // Same size, deep-equal content (identity on valid pages).
        expect(normalized).toHaveLength(TOTAL_CELLS);
        expect(normalized).toEqual(page);
      }),
      { numRuns: 100 },
    );
  });
});
