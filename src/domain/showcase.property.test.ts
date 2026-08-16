/**
 * What the front page is allowed to put on air.
 *
 * This is the one screen shown to someone who has not chosen anything yet, so
 * the two exclusions are the whole point of the module: the open playground
 * must never reach it, and a page that is claimed but blank is not a showcase.
 * Both are asserted here rather than left to the component, because getting
 * either wrong is invisible in review and obvious to a visitor.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  SHOWCASE_STRIP,
  hasInk,
  initialGrid,
  nextIndex,
  showcaseScreens,
  startIndex,
} from './showcase';
import { pageToCellMap } from './pageEncoding';
import { COLS, createEmptyPage, type TeletextPage } from '../types/teletext';

/** A page with a word written on it, as the editor would leave it. */
function pageSaying(text: string): TeletextPage {
  const page = createEmptyPage();
  for (let i = 0; i < text.length; i += 1) {
    page[COLS * 2 + i] = { char: text[i], fg: 'white', bg: 'black', graphics: null };
  }
  return page;
}

const inked = () => pageToCellMap(pageSaying('NOTICIAS'));
const blank = () => pageToCellMap(createEmptyPage());

describe('hasInk', () => {
  it('is false for a blank page and for a cleared slot', () => {
    expect(hasInk(blank())).toBe(false);
    expect(hasInk({})).toBe(false);
    expect(hasInk(undefined)).toBe(false);
  });

  it('is true for a character, and for graphics alone', () => {
    expect(hasInk(inked())).toBe(true);
    expect(
      hasInk({ 0: { char: ' ', fg: 'white', bg: 'black', graphics: 63 } }),
    ).toBe(true);
  });

  it('never throws, whatever the document holds', () => {
    // The `pages` channel is writable by any client.
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => hasInk(value)).not.toThrow();
      }),
    );
  });
});

describe('showcaseScreens', () => {
  it('never shows the open playground', () => {
    // 700+ is writable by every visitor. The front page is the one surface that
    // cannot be whatever someone typed there a minute ago.
    const screens = showcaseScreens(
      { 220: inked(), 700: inked(), 999: inked() },
      {},
    );
    expect(screens.map((s) => s.pageNumber)).toEqual([220]);
  });

  it('skips a page that is claimed but blank', () => {
    // A page with a title or a directory heading is occupied and has nothing to
    // look at; showcasing it would put an empty rectangle on the front page.
    const screens = showcaseScreens({ 220: inked(), 221: blank(), 222: {} }, {});
    expect(screens.map((s) => s.pageNumber)).toEqual([220]);
  });

  it('shows each screen of a carousel, in order, carrying its length', () => {
    const screens = showcaseScreens(
      { 220: inked(), '220.2': inked(), '220.3': inked() },
      { 220: 3 },
    );
    expect(screens.map((s) => `${s.pageNumber}.${s.subpage}`)).toEqual([
      '220.1',
      '220.2',
      '220.3',
    ]);
    expect(screens.every((s) => s.subpageCount === 3)).toBe(true);
  });

  it('orders by page then screen, whatever order the document is in', () => {
    const screens = showcaseScreens(
      { '300.2': inked(), 220: inked(), 300: inked(), '220.4': inked() },
      { 220: 4, 300: 2 },
    );
    expect(screens.map((s) => `${s.pageNumber}.${s.subpage}`)).toEqual([
      '220.1',
      '220.4',
      '300.1',
      '300.2',
    ]);
  });

  it('drops a key it cannot read rather than guessing a page from it', () => {
    expect(
      showcaseScreens({ 'not-a-page': inked(), '220.': inked() }, {}),
    ).toEqual([]);
  });

  it('never throws, whatever the document holds', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (pages, counts) => {
        expect(() =>
          showcaseScreens(pages as Record<string, unknown>, counts as never),
        ).not.toThrow();
      }),
    );
  });
});

describe('the rotation', () => {
  it('starts somewhere in range for any random value', () => {
    // Two visits should not open on the same page — 600 pages that always
    // begin at 100 suggest there is only one.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 600 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (length, random) => {
          const index = startIndex(length, random);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(length);
        },
      ),
    );
  });

  it('holds at zero when there is nothing to show', () => {
    expect(startIndex(0, 0.9)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
  });

  it('wraps, so the archive is itself a carousel', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (length) => {
        expect(nextIndex(length - 1, length)).toBe(0);
      }),
    );
  });

  it('visits every screen before repeating one', () => {
    const length = 7;
    const seen = new Set<number>();
    let index = startIndex(length, 0.5);
    for (let i = 0; i < length; i += 1) {
      seen.add(index);
      index = nextIndex(index, length);
    }
    expect(seen.size).toBe(length);
  });
});

describe('the strip', () => {
  it('fills the strip from a run, all different', () => {
    const riding = initialGrid(40, 0.5);
    expect(riding).toHaveLength(SHOWCASE_STRIP);
    expect(new Set(riding).size).toBe(SHOWCASE_STRIP);
  });

  it('rides only as many pages as there are', () => {
    // A strip of twelve drawn from six would repeat, and the same page passing
    // twice in a row looks like a fault rather than a service.
    expect(initialGrid(6, 0.2)).toHaveLength(6);
    expect(initialGrid(0, 0.2)).toEqual([]);
  });

  it('never repeats a page within one pass, from any start', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (total, seed) => {
          const riding = initialGrid(total, seed);
          expect(new Set(riding).size).toBe(riding.length);
          for (const index of riding) {
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(total);
          }
        },
      ),
    );
  });
});
