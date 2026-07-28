// Feature: archive vs. playground page access.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canEditPage, isArchivePage, PLAYGROUND_MIN_PAGE } from './access';

/**
 * The archive/playground boundary: pages 100..(PLAYGROUND_MIN_PAGE - 1) are
 * the curated archive, editable only by a moderator; pages
 * PLAYGROUND_MIN_PAGE..999 are the open playground, editable by anyone.
 * Numbers outside 100..999 aren't valid pages at all, so nobody can edit them.
 */

/** Independent oracle for `isArchivePage`, derived from the acceptance criteria. */
function expectedIsArchivePage(n: number): boolean {
  return Number.isInteger(n) && n >= 100 && n < PLAYGROUND_MIN_PAGE;
}

/** Independent oracle for `canEditPage`. */
function expectedCanEditPage(n: number, isModerator: boolean): boolean {
  if (!Number.isInteger(n) || n < 100 || n > 999) return false;
  return isModerator || !expectedIsArchivePage(n);
}

/** Broad coverage: in-range archive/playground numbers, boundaries, and invalid input. */
const numberArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 100, max: 999 }),
  fc.constantFrom(
    99,
    100,
    PLAYGROUND_MIN_PAGE - 1,
    PLAYGROUND_MIN_PAGE,
    PLAYGROUND_MIN_PAGE + 1,
    998,
    999,
    1000,
    0,
    -1,
  ),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

describe('archive/playground access', () => {
  it('isArchivePage(n) matches an independent oracle', () => {
    fc.assert(
      fc.property(numberArb, (n) => {
        expect(isArchivePage(n)).toBe(expectedIsArchivePage(n));
      }),
      { numRuns: 500 },
    );
  });

  it('canEditPage(n, isModerator) matches an independent oracle', () => {
    fc.assert(
      fc.property(numberArb, fc.boolean(), (n, isModerator) => {
        expect(canEditPage(n, isModerator)).toBe(expectedCanEditPage(n, isModerator));
      }),
      { numRuns: 500 },
    );
  });

  it('a moderator can always edit any valid page, archive or playground', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 999 }), (n) => {
        expect(canEditPage(n, true)).toBe(true);
      }),
    );
  });
});
