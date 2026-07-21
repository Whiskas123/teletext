// Feature: collaborative-teletext-rooms, Property 6: Next/previous navigation skips empty pages and wraps
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { nextNonEmptyPage, prevNonEmptyPage } from './pageOps';
import type { Cell } from '../types/teletext';
import type { PageCellMap, PagesData } from '../collab/types';

/**
 * Property 6: Next/previous navigation skips empty pages and wraps.
 *
 * For any mapping of Page_Numbers to pages and any current Page_Number,
 * `nextNonEmptyPage` returns the nearest higher Non_Empty_Page wrapping from
 * 999 to 100, `prevNonEmptyPage` returns the nearest lower Non_Empty_Page
 * wrapping from 100 to 999, and each returns null iff no Non_Empty_Page other
 * than the current one exists.
 *
 * **Validates: Requirements 3.6, 3.7, 3.8**
 */

const MIN_PAGE = 100;
const MAX_PAGE = 999;

/** A single non-empty cell (differs from the default empty cell). */
const NON_EMPTY_CELL: Cell = { char: 'X', fg: 'white', bg: 'black', graphics: null };

/**
 * Build a {@link PagesData} where every Page_Number in `nonEmpty` maps to a
 * Non_Empty_Page (cell index 0 set to a non-empty cell); all other Page_Numbers
 * are absent (treated as empty).
 */
function buildPages(nonEmpty: readonly number[]): PagesData {
  const pages: PagesData = {};
  for (const n of nonEmpty) {
    const map: PageCellMap = { 0: { ...NON_EMPTY_CELL } };
    pages[n] = map;
  }
  return pages;
}

/**
 * Independent oracle for the nearest higher Non_Empty_Page relative to `cur`,
 * wrapping from 999 to 1, excluding `cur`. Returns null when no other
 * Non_Empty_Page exists.
 */
function oracleNext(cur: number, nonEmpty: readonly number[]): number | null {
  const candidates = nonEmpty.filter((n) => n !== cur).sort((a, b) => a - b);
  if (candidates.length === 0) return null;
  const higher = candidates.find((n) => n > cur);
  return higher !== undefined ? higher : candidates[0];
}

/**
 * Independent oracle for the nearest lower Non_Empty_Page relative to `cur`,
 * wrapping from 1 to 999, excluding `cur`. Returns null when no other
 * Non_Empty_Page exists.
 */
function oraclePrev(cur: number, nonEmpty: readonly number[]): number | null {
  const candidates = nonEmpty.filter((n) => n !== cur).sort((a, b) => a - b);
  if (candidates.length === 0) return null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i] < cur) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

const pageNumberArb: fc.Arbitrary<number> = fc.integer({ min: MIN_PAGE, max: MAX_PAGE });

/** A small set of distinct non-empty Page_Numbers (may be empty). */
const nonEmptySetArb: fc.Arbitrary<number[]> = fc.uniqueArray(pageNumberArb, {
  minLength: 0,
  maxLength: 8,
});

describe('Property 6: Next/previous navigation skips empty pages and wraps', () => {
  it('nextNonEmptyPage matches the nearest-higher wrap oracle', () => {
    fc.assert(
      fc.property(nonEmptySetArb, pageNumberArb, (nonEmpty, cur) => {
        const pages = buildPages(nonEmpty);
        const expected = oracleNext(cur, nonEmpty);
        expect(nextNonEmptyPage(cur, pages)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('prevNonEmptyPage matches the nearest-lower wrap oracle', () => {
    fc.assert(
      fc.property(nonEmptySetArb, pageNumberArb, (nonEmpty, cur) => {
        const pages = buildPages(nonEmpty);
        const expected = oraclePrev(cur, nonEmpty);
        expect(prevNonEmptyPage(cur, pages)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('both return null iff no Non_Empty_Page other than the current exists', () => {
    fc.assert(
      fc.property(nonEmptySetArb, pageNumberArb, (nonEmpty, cur) => {
        const pages = buildPages(nonEmpty);
        const hasOther = nonEmpty.some((n) => n !== cur);
        expect(nextNonEmptyPage(cur, pages) === null).toBe(!hasOther);
        expect(prevNonEmptyPage(cur, pages) === null).toBe(!hasOther);
      }),
      { numRuns: 200 },
    );
  });

  it('covers edge cases: empty set, singleton == cur, and multiple pages', () => {
    // Empty set: no non-empty pages -> null for any current page.
    expect(nextNonEmptyPage(100, buildPages([]))).toBeNull();
    expect(prevNonEmptyPage(100, buildPages([]))).toBeNull();

    // Singleton equal to the current page: no *other* non-empty page -> null.
    expect(nextNonEmptyPage(250, buildPages([250]))).toBeNull();
    expect(prevNonEmptyPage(250, buildPages([250]))).toBeNull();

    // Multiple pages, no wrap: nearest higher / lower excluding current.
    const multi = buildPages([100, 300, 500, 900]);
    expect(nextNonEmptyPage(300, multi)).toBe(500);
    expect(prevNonEmptyPage(300, multi)).toBe(100);

    // Wrap: from the top non-empty, next wraps to the lowest; from the bottom,
    // prev wraps to the highest.
    expect(nextNonEmptyPage(900, multi)).toBe(100);
    expect(prevNonEmptyPage(100, multi)).toBe(900);

    // Current page not itself non-empty still finds the neighbors.
    expect(nextNonEmptyPage(250, multi)).toBe(300);
    expect(prevNonEmptyPage(250, multi)).toBe(100);
  });
});
