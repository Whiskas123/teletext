/**
 * Tests for grouping and filtering the pages on air.
 *
 * Two properties carry the weight. The list shown must always be a *subset* of
 * the pages that exist — a filter that invented a page, or listed one twice,
 * would send an operator to nudge or delete something that is not there. And
 * each group must stay in ascending page order, because the order is what the
 * directory and the reordering tools read meaning from.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PLAYGROUND_MIN_PAGE } from './access';
import {
  EMPTY_ON_AIR_FILTER,
  MAX_ON_AIR_FILTER,
  clampFilterText,
  groupOf,
  groupOnAirPages,
  isFiltering,
  matchesOnAirFilter,
  type OnAirFilter,
  type OnAirRow,
} from './onAirList';

const arbRow: fc.Arbitrary<OnAirRow> = fc
  .record({
    pageNumber: fc.integer({ min: 100, max: 999 }),
    title: fc.string({ maxLength: 24 }),
    published: fc.boolean(),
    hasContent: fc.boolean(),
  })
  .map((row) => ({ ...row, group: groupOf(row.pageNumber) }));

const arbRows = fc.uniqueArray(arbRow, {
  selector: (row) => row.pageNumber,
  maxLength: 60,
});

const arbFilter: fc.Arbitrary<OnAirFilter> = fc.record({
  text: fc.string({ maxLength: MAX_ON_AIR_FILTER }),
  publication: fc.constantFrom('both', 'published', 'hand-made'),
  range: fc.constantFrom('both', 'curated', 'playground'),
});

describe('groupOf', () => {
  it('splits exactly at the playground boundary', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 999 }), (pageNumber) => {
        expect(groupOf(pageNumber)).toBe(
          pageNumber < PLAYGROUND_MIN_PAGE ? 'curated' : 'playground',
        );
      }),
    );
  });
});

describe('groupOnAirPages', () => {
  it('shows a subset of what it was given, each page once', () => {
    fc.assert(
      fc.property(arbRows, arbFilter, (rows, filter) => {
        const groups = groupOnAirPages(rows, filter);
        const shown = [...groups.curated, ...groups.playground];
        const existing = new Set(rows.map((row) => row.pageNumber));

        for (const row of shown) expect(existing.has(row.pageNumber)).toBe(true);
        expect(new Set(shown.map((row) => row.pageNumber)).size).toBe(shown.length);
        expect(groups.shown).toBe(shown.length);
        expect(groups.shown).toBeLessThanOrEqual(groups.total);
        expect(groups.total).toBe(rows.length);
      }),
    );
  });

  it('keeps each group in ascending page order, whatever the input order', () => {
    fc.assert(
      fc.property(arbRows, arbFilter, (rows, filter) => {
        const groups = groupOnAirPages([...rows].reverse(), filter);
        for (const group of [groups.curated, groups.playground]) {
          const numbers = group.map((row) => row.pageNumber);
          expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        }
      }),
    );
  });

  it('files every shown page in the group its number belongs to', () => {
    fc.assert(
      fc.property(arbRows, arbFilter, (rows, filter) => {
        const groups = groupOnAirPages(rows, filter);
        for (const row of groups.curated) {
          expect(row.pageNumber).toBeLessThan(PLAYGROUND_MIN_PAGE);
        }
        for (const row of groups.playground) {
          expect(row.pageNumber).toBeGreaterThanOrEqual(PLAYGROUND_MIN_PAGE);
        }
      }),
    );
  });

  it('shows everything when nothing is restricted', () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const groups = groupOnAirPages(rows, EMPTY_ON_AIR_FILTER);
        expect(groups.shown).toBe(rows.length);
      }),
    );
  });
});

describe('matchesOnAirFilter', () => {
  it('matches a page number as a substring, ignoring surrounding space', () => {
    fc.assert(
      fc.property(arbRow, (row) => {
        const text = ` ${String(row.pageNumber)} `;
        expect(
          matchesOnAirFilter(row, { ...EMPTY_ON_AIR_FILTER, text }),
        ).toBe(true);
      }),
    );
  });

  it('matches a title without regard to case', () => {
    fc.assert(
      fc.property(arbRow, (row) => {
        fc.pre(row.title.trim().length > 0);
        expect(
          matchesOnAirFilter(row, {
            ...EMPTY_ON_AIR_FILTER,
            text: row.title.trim().toUpperCase(),
          }),
        ).toBe(true);
      }),
    );
  });

  it('honours the publication restriction', () => {
    fc.assert(
      fc.property(arbRow, (row) => {
        expect(
          matchesOnAirFilter(row, { ...EMPTY_ON_AIR_FILTER, publication: 'published' }),
        ).toBe(row.published);
        expect(
          matchesOnAirFilter(row, { ...EMPTY_ON_AIR_FILTER, publication: 'hand-made' }),
        ).toBe(!row.published);
      }),
    );
  });

  it('honours the range restriction', () => {
    fc.assert(
      fc.property(arbRow, (row) => {
        expect(
          matchesOnAirFilter(row, { ...EMPTY_ON_AIR_FILTER, range: 'curated' }),
        ).toBe(row.group === 'curated');
        expect(
          matchesOnAirFilter(row, { ...EMPTY_ON_AIR_FILTER, range: 'playground' }),
        ).toBe(row.group === 'playground');
      }),
    );
  });
});

describe('isFiltering', () => {
  it('is false for the empty filter and for whitespace-only text', () => {
    expect(isFiltering(EMPTY_ON_AIR_FILTER)).toBe(false);
    expect(isFiltering({ ...EMPTY_ON_AIR_FILTER, text: '   ' })).toBe(false);
  });

  it('is true as soon as anything is narrowed', () => {
    fc.assert(
      fc.property(arbFilter, (filter) => {
        const narrowed =
          filter.text.trim().length > 0 ||
          filter.publication !== 'both' ||
          filter.range !== 'both';
        expect(isFiltering(filter)).toBe(narrowed);
      }),
    );
  });
});

describe('clampFilterText', () => {
  it('never returns more than the accepted length', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        const clamped = clampFilterText(text);
        expect(clamped.length).toBeLessThanOrEqual(MAX_ON_AIR_FILTER);
        expect(text.startsWith(clamped)).toBe(true);
      }),
    );
  });
});
