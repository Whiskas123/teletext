/**
 * Property tests for the playhtml <-> database page encoding.
 *
 * The round trip is the thing that matters: a page written to the database and
 * read back into playhtml must be the page that went in. Every published page
 * and every restored backup crosses this boundary, so a lossy conversion would
 * corrupt content silently and at scale.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isCompletePageArray, pageToArray, pageToCellMap } from './pageEncoding';
import {
  TELETEXT_COLORS,
  TOTAL_CELLS,
  type Cell,
  type SixelColors,
} from '../types/teletext';

const arbColor = fc.constantFrom(...TELETEXT_COLORS);

const arbCell: fc.Arbitrary<Cell> = fc.record(
  {
    char: fc.constantFrom(' ', 'A', 'z', '0', 'É', 'ç', '#'),
    fg: arbColor,
    bg: arbColor,
    graphics: fc.option(fc.integer({ min: 0, max: 63 }), { nil: null }),
    graphicsColors: fc.option(
      fc.tuple(arbColor, arbColor, arbColor, arbColor, arbColor, arbColor),
      { nil: undefined },
    ) as fc.Arbitrary<SixelColors | undefined>,
    blink: fc.option(fc.boolean(), { nil: undefined }),
    doubleHeight: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ['char', 'fg', 'bg'] },
);

const arbPage = fc.array(arbCell, {
  minLength: TOTAL_CELLS,
  maxLength: TOTAL_CELLS,
});

describe('page encoding round trip', () => {
  it('array -> map -> array is identity', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        expect(pageToArray(pageToCellMap(page))).toEqual(page);
      }),
    );
  });

  it('always produces exactly TOTAL_CELLS, whatever it is handed', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbPage,
          fc.constant(undefined),
          fc.constant(null),
          fc.constant({}),
          fc.dictionary(fc.integer({ min: 0, max: 959 }).map(String), arbCell),
        ),
        (input) => {
          expect(pageToArray(input)).toHaveLength(TOTAL_CELLS);
          expect(Object.keys(pageToCellMap(input))).toHaveLength(TOTAL_CELLS);
        },
      ),
    );
  });

  it('fills a sparse map so replaced pages do not keep old content', () => {
    // A page written by an import must be complete: a cell the new content
    // leaves blank has to end up blank, not retain whatever was there.
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.integer({ min: 0, max: 959 }).map(String),
          arbCell,
          { maxKeys: 20 },
        ),
        (sparse) => {
          const map = pageToCellMap(sparse);
          for (let i = 0; i < TOTAL_CELLS; i += 1) {
            expect(map[i]).toBeDefined();
          }
        },
      ),
    );
  });

  it('does not alias cells between the two forms', () => {
    // Mutating what went into the store must not reach back into the page the
    // caller still holds.
    fc.assert(
      fc.property(arbPage, (page) => {
        const map = pageToCellMap(page);
        map[0].char = 'X';
        expect(page[0].char).not.toBe('X');
      }),
    );
  });
});

describe('isCompletePageArray', () => {
  it('accepts a full page', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        expect(isCompletePageArray(page)).toBe(true);
      }),
    );
  });

  it('rejects anything the normaliser would have had to repair', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant({}),
          fc.array(arbCell, { maxLength: TOTAL_CELLS - 1 }),
          fc.array(arbCell, { minLength: TOTAL_CELLS + 1, maxLength: TOTAL_CELLS + 5 }),
        ),
        (bad) => {
          expect(isCompletePageArray(bad)).toBe(false);
        },
      ),
    );
  });
});
