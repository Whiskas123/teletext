// Feature: collaborative-teletext-rooms, Property 8: Accept threshold is a strict majority
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { acceptThreshold } from './voting';

/**
 * Property 8: Accept threshold is a strict majority.
 *
 * For any Vote_Base `b >= 1`, `acceptThreshold(b) = floor(b / 2) + 1` and
 * `2 * acceptThreshold(b) > b` (a strict majority). Additionally the threshold
 * never exceeds the base for `b >= 1`, so it is always attainable.
 *
 * Validates: Requirements 4.6
 */

const NUM_RUNS = 200;

describe('Property 8: Accept threshold is a strict majority', () => {
  it('acceptThreshold(b) === floor(b/2)+1, is a strict majority, and never exceeds b for any b >= 1', () => {
    fc.assert(
      fc.property(
        // Vote_Base b >= 1, spanning small values through very large bases.
        fc.integer({ min: 1, max: 1_000_000_000 }),
        (b) => {
          const t = acceptThreshold(b);

          // Exact formula.
          expect(t).toBe(Math.floor(b / 2) + 1);

          // Strict majority: more than half the base.
          expect(2 * t).toBeGreaterThan(b);

          // Attainable: threshold never exceeds the base for b >= 1.
          expect(t).toBeLessThanOrEqual(b);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds for the boundary base of 1 (single member needs one accept vote)', () => {
    expect(acceptThreshold(1)).toBe(1);
    expect(2 * acceptThreshold(1)).toBeGreaterThan(1);
    expect(acceptThreshold(1)).toBeLessThanOrEqual(1);
  });
});
