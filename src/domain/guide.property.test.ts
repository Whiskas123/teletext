// Feature: collaborative-teletext-rooms, Property 22: Guide listing has exactly the qualifying entries in ascending order
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { guideEntries, type GuideEntry } from './guide';
import type { Cell } from '../types/teletext';
import type { PageCellMap, PagesData, TitlesData } from '../collab/types';

/**
 * Property 22: Guide listing has exactly the qualifying entries in ascending
 * order.
 *
 * For any mapping of pages and titles, `guideEntries` contains exactly the
 * Page_Numbers in 100..999 that are a Non_Empty_Page OR have a Page_Title of
 * length 1 or greater, each paired with its current Page_Title, ordered strictly
 * ascending by Page_Number (and is empty when no Page_Number qualifies).
 *
 * **Validates: Requirements 9.7, 9.11, 9.13**
 */

const MIN_PAGE = 100;
const MAX_PAGE = 999;

/** A single non-empty cell (differs from the default empty cell). */
const NON_EMPTY_CELL: Cell = { char: 'X', fg: 'white', bg: 'black', graphics: null };

/**
 * The current Page_Title stored for `n`, or `''` when absent/non-string.
 * Mirrors the independent oracle notion of "title at" without depending on the
 * module under test.
 */
function titleAt(titles: TitlesData, n: number): string {
  const raw = titles ? (titles as Record<PropertyKey, unknown>)[n] : undefined;
  return typeof raw === 'string' ? raw : '';
}

/**
 * Whether the stored page at `n` is a Non_Empty_Page, per the same convention
 * used to build the arbitrary: a present `PageCellMap` with at least one cell is
 * non-empty; an absent key or an empty map `{}` is empty.
 */
function isNonEmptyAt(pages: PagesData, n: number): boolean {
  const raw = pages ? (pages as Record<PropertyKey, unknown>)[n] : undefined;
  if (raw === undefined || raw === null) return false;
  return Object.keys(raw as PageCellMap).length > 0;
}

/**
 * Independent oracle: exactly the qualifying entries, ascending by Page_Number.
 */
function oracle(pages: PagesData, titles: TitlesData): GuideEntry[] {
  const entries: GuideEntry[] = [];
  for (let n = MIN_PAGE; n <= MAX_PAGE; n++) {
    const title = titleAt(titles, n);
    if (title.length >= 1 || isNonEmptyAt(pages, n)) {
      entries.push({ pageNumber: n, title });
    }
  }
  return entries;
}

const pageNumberArb: fc.Arbitrary<number> = fc.integer({
  min: MIN_PAGE,
  max: MAX_PAGE,
});

/**
 * A PageCellMap that is either non-empty (a single non-empty cell at index 0)
 * or empty (`{}`), so the generated pages exercise both qualifying and
 * non-qualifying page content.
 */
const pageCellMapArb: fc.Arbitrary<PageCellMap> = fc.oneof(
  fc.constant<PageCellMap>({ 0: { ...NON_EMPTY_CELL } }),
  fc.constant<PageCellMap>({}),
);

/** An arbitrary PagesData over a subset of Page_Numbers. */
const pagesArb: fc.Arbitrary<PagesData> = fc
  .array(fc.tuple(pageNumberArb, pageCellMapArb), { minLength: 0, maxLength: 12 })
  .map((pairs) => {
    const pages: PagesData = {};
    for (const [n, map] of pairs) pages[n] = map;
    return pages;
  });

/** A title string that is either empty (`''`) or non-empty (length >= 1). */
const titleArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 60 }),
);

/** An arbitrary TitlesData over a subset of Page_Numbers. */
const titlesArb: fc.Arbitrary<TitlesData> = fc
  .array(fc.tuple(pageNumberArb, titleArb), { minLength: 0, maxLength: 12 })
  .map((pairs) => {
    const titles: TitlesData = {};
    for (const [n, t] of pairs) titles[n] = t;
    return titles;
  });

describe('Property 22: Guide listing has exactly the qualifying entries in ascending order', () => {
  it('equals the independent oracle and is strictly ascending by Page_Number', () => {
    fc.assert(
      fc.property(pagesArb, titlesArb, (pages, titles) => {
        const expected = oracle(pages, titles);
        const actual = guideEntries(pages, titles);

        // Exactly the qualifying entries, each paired with its current title
        // (Req 9.7, 9.13).
        expect(actual).toEqual(expected);

        // Strictly ascending by Page_Number with no duplicates (Req 9.7).
        for (let i = 1; i < actual.length; i += 1) {
          expect(actual[i].pageNumber).toBeGreaterThan(actual[i - 1].pageNumber);
        }

        // Membership check: a Page_Number appears iff it qualifies.
        const listed = new Set(actual.map((e) => e.pageNumber));
        for (let n = MIN_PAGE; n <= MAX_PAGE; n += 1) {
          const qualifies =
            titleAt(titles, n).length >= 1 || isNonEmptyAt(pages, n);
          expect(listed.has(n)).toBe(qualifies);
        }

        // Every listed entry carries its current title (Req 9.13).
        for (const entry of actual) {
          expect(entry.title).toBe(titleAt(titles, entry.pageNumber));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('is empty when no Page_Number qualifies', () => {
    fc.assert(
      fc.property(
        // Only empty page maps and only empty titles => nothing qualifies.
        fc
          .array(fc.tuple(pageNumberArb, fc.constant<PageCellMap>({})), {
            minLength: 0,
            maxLength: 12,
          })
          .map((pairs) => {
            const pages: PagesData = {};
            for (const [n, map] of pairs) pages[n] = map;
            return pages;
          }),
        fc
          .array(fc.tuple(pageNumberArb, fc.constant('')), {
            minLength: 0,
            maxLength: 12,
          })
          .map((pairs) => {
            const titles: TitlesData = {};
            for (const [n, t] of pairs) titles[n] = t;
            return titles;
          }),
        (pages, titles) => {
          expect(guideEntries(pages, titles)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('covers edge cases: empty inputs, title-only, page-only, and both', () => {
    // Empty inputs => empty guide (Req 9.11).
    expect(guideEntries({}, {})).toEqual([]);

    // Title-only qualification (page absent).
    expect(guideEntries({}, { 100: 'News' })).toEqual([
      { pageNumber: 100, title: 'News' },
    ]);

    // Page-only qualification (title absent => '').
    expect(
      guideEntries({ 250: { 0: { ...NON_EMPTY_CELL } } }, {}),
    ).toEqual([{ pageNumber: 250, title: '' }]);

    // Empty page map does not qualify; empty title does not qualify.
    expect(guideEntries({ 300: {} }, { 300: '' })).toEqual([]);

    // Both content and title, ordered ascending.
    expect(
      guideEntries(
        { 500: { 0: { ...NON_EMPTY_CELL } }, 100: {} },
        { 100: 'Index', 900: 'Weather' },
      ),
    ).toEqual([
      { pageNumber: 100, title: 'Index' },
      { pageNumber: 500, title: '' },
      { pageNumber: 900, title: 'Weather' },
    ]);
  });
});
