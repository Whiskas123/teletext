// Feature: collaborative-teletext-rooms, Property 5: Displayed page changes are range-validated
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { inPageRange } from './pageOps';

/**
 * Property 5: Displayed page changes are range-validated.
 *
 * For any number `n`, `inPageRange(n)` is true iff `n` is an integer in the
 * inclusive range 100..999; otherwise it is false. This backs
 * `setDisplayedPage(n)`, which applies the change iff `inPageRange(n)` and
 * otherwise retains the current displayed Page_Number.
 *
 * **Validates: Requirements 3.5**
 */

/** The oracle: an integer within the inclusive range 100..999. */
function expected(n: number): boolean {
  return Number.isInteger(n) && n >= 100 && n <= 999;
}

/**
 * A broad arbitrary covering the whole input space:
 * - integers inside the range (100..999)
 * - integers below the range (1..99, 0, negatives)
 * - integers above the range (1000+)
 * - arbitrary integers (very large / very negative)
 * - non-integer floats
 * - special values (NaN, +/-Infinity, -0)
 */
const numberArb: fc.Arbitrary<number> = fc.oneof(
  // In-range integers.
  fc.integer({ min: 100, max: 999 }),
  // Below-range integers (1..99) that used to be valid.
  fc.integer({ min: 1, max: 99 }),
  // Boundary + near-boundary integers.
  fc.constantFrom(0, 1, 99, 100, 101, 998, 999, 1000, 1001, -1),
  // Arbitrary integers, including very large / very negative.
  fc.integer(),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.constantFrom(
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    1e21,
    -1e21,
  ),
  // Floats (non-integers should be rejected).
  fc.double({ noNaN: true }),
  fc.double({ min: 100, max: 999, noNaN: true }),
  // Special values.
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0),
);

describe('Property 5: Displayed page changes are range-validated', () => {
  it('inPageRange(n) is true iff n is an integer in 100..999', () => {
    fc.assert(
      fc.property(numberArb, (n) => {
        expect(inPageRange(n)).toBe(expected(n));
      }),
      { numRuns: 500 },
    );
  });
});
