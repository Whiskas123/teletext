/**
 * Properties of the subpage key format and carousel navigation.
 *
 * The key format carries the whole compatibility story (see `subpages.ts`):
 * subpage 1 must keep the bare page-number key every existing reader already
 * uses, and subpages 2+ must round-trip through a form those readers reject
 * rather than misread. Both are asserted here rather than assumed, because a
 * regression in either silently corrupts pages instead of failing loudly.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MAX_SUBPAGE,
  MIN_SUBPAGE,
  clampSubpage,
  formatSubpageIndicator,
  normalizeSubpage,
  pageKey,
  pageKeys,
  parsePageKey,
  stepSubpage,
  subpageCountOf,
} from './subpages';

const anyPage = fc.integer({ min: 100, max: 999 });
const anySubpage = fc.integer({ min: MIN_SUBPAGE, max: MAX_SUBPAGE });

describe('pageKey / parsePageKey', () => {
  it('gives subpage 1 the bare page number, so nothing needs migrating', () => {
    fc.assert(
      fc.property(anyPage, (pageNumber) => {
        expect(pageKey(pageNumber, MIN_SUBPAGE)).toBe(pageNumber);
      }),
    );
  });

  it('round-trips every page and subpage', () => {
    fc.assert(
      fc.property(anyPage, anySubpage, (pageNumber, subpage) => {
        expect(parsePageKey(pageKey(pageNumber, subpage))).toEqual({
          pageNumber,
          subpage,
        });
      }),
    );
  });

  it('produces keys a subpage-unaware reader skips rather than misreads', () => {
    // Every existing reader of the `pages` channel guards with
    // `Number.isInteger` before using a key as a page number. A composite key
    // must therefore fail that check — otherwise subpage 2 of page 220 would
    // read as some other page.
    fc.assert(
      fc.property(
        anyPage,
        fc.integer({ min: 2, max: MAX_SUBPAGE }),
        (pageNumber, subpage) => {
          expect(Number.isInteger(Number(pageKey(pageNumber, subpage)))).toBe(false);
        },
      ),
    );
  });

  it('refuses a second spelling of subpage 1', () => {
    // `"220.1"` and `"220"` would be one page under two keys, which no reader
    // could reconcile.
    fc.assert(
      fc.property(anyPage, (pageNumber) => {
        expect(parsePageKey(`${pageNumber}.1`)).toBeNull();
      }),
    );
  });

  it('rejects junk instead of guessing', () => {
    for (const key of ['', '.', 'x', '220.', '.2', '220.0', '220.2.3', '220.x']) {
      expect(parsePageKey(key)).toBeNull();
    }
    expect(parsePageKey(`220.${MAX_SUBPAGE + 1}`)).toBeNull();
  });

  it('lists exactly `count` keys, starting at the bare page number', () => {
    fc.assert(
      fc.property(anyPage, anySubpage, (pageNumber, count) => {
        const keys = pageKeys(pageNumber, count);
        expect(keys).toHaveLength(count);
        expect(keys[0]).toBe(pageNumber);
        expect(new Set(keys).size).toBe(count);
      }),
    );
  });
});

describe('normalizeSubpage', () => {
  it('always lands in range, for any input at all', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const value = normalizeSubpage(raw);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(MIN_SUBPAGE);
        expect(value).toBeLessThanOrEqual(MAX_SUBPAGE);
      }),
    );
  });

  it('treats an absent or unreadable count as one subpage', () => {
    expect(subpageCountOf({}, 220)).toBe(MIN_SUBPAGE);
    expect(subpageCountOf(null, 220)).toBe(MIN_SUBPAGE);
    expect(subpageCountOf({ 220: 0 } as Record<number, number>, 220)).toBe(MIN_SUBPAGE);
    expect(subpageCountOf({ 220: 4 }, 220)).toBe(4);
  });
});

describe('stepSubpage', () => {
  it('stays within 1..count whatever the step', () => {
    fc.assert(
      fc.property(
        anySubpage,
        anySubpage,
        fc.integer({ min: -50, max: 50 }),
        (subpage, count, delta) => {
          const next = stepSubpage(subpage, count, delta);
          expect(next).toBeGreaterThanOrEqual(MIN_SUBPAGE);
          expect(next).toBeLessThanOrEqual(clampSubpage(count, count));
        },
      ),
    );
  });

  it('wraps, so the carousel is a loop in both directions', () => {
    fc.assert(
      fc.property(anySubpage, (count) => {
        expect(stepSubpage(count, count, 1)).toBe(MIN_SUBPAGE);
        expect(stepSubpage(MIN_SUBPAGE, count, -1)).toBe(count);
      }),
    );
  });

  it('is a no-op on a page with a single subpage', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), (delta) => {
        expect(stepSubpage(MIN_SUBPAGE, 1, delta)).toBe(MIN_SUBPAGE);
      }),
    );
  });
});

describe('formatSubpageIndicator', () => {
  it('shows 1/1 for a page with no carousel', () => {
    expect(formatSubpageIndicator(1, 1)).toBe('1/1');
  });

  it('never shows a subpage past the count', () => {
    fc.assert(
      fc.property(fc.integer({ min: -9, max: 99 }), anySubpage, (subpage, count) => {
        const [shown, total] = formatSubpageIndicator(subpage, count).split('/');
        expect(Number(shown)).toBeLessThanOrEqual(Number(total));
        expect(Number(shown)).toBeGreaterThanOrEqual(MIN_SUBPAGE);
      }),
    );
  });
});
