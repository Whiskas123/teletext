/**
 * The order the front page's strip runs in.
 *
 * What is *on* the strip is a moderator's choice now, recorded in the database
 * — so the only decision left here is the per-visit shuffle, and the thing that
 * would go wrong with it is silent: a page dropped or repeated is only noticed
 * by the one person looking for the page that went missing.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  showcasePicturePath,
  showcaseVersionKey,
  shuffleBySeed,
} from './showcase';

describe('shuffleBySeed', () => {
  it('keeps every page, exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 30 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (items, seed) => {
          const shuffled = shuffleBySeed(items, seed);
          expect(shuffled).toHaveLength(items.length);
          expect([...shuffled].sort()).toEqual([...items].sort());
        },
      ),
    );
  });

  it('gives the same order for the same seed', () => {
    // Both copies of the looping strip are rendered from this, and they have to
    // match or the join would jump.
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffleBySeed(items, 0.42)).toEqual(shuffleBySeed(items, 0.42));
  });

  it('gives different orders for different seeds', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const orders = new Set(
      [0.1, 0.35, 0.6, 0.9].map((seed) => shuffleBySeed(items, seed).join()),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('leaves nothing to shuffle alone', () => {
    expect(shuffleBySeed([], 0.5)).toEqual([]);
    expect(shuffleBySeed(['only'], 0.5)).toEqual(['only']);
  });

  it('never throws, whatever seed it is handed', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (seed) => {
        expect(() => shuffleBySeed([1, 2, 3], seed)).not.toThrow();
      }),
    );
  });
});

describe('showcasePicturePath', () => {
  it('puts the version in the name, so a redraw is a different file', () => {
    const before = showcasePicturePath(101, 1, '2026-08-16T15:28:48.638Z');
    const after = showcasePicturePath(101, 1, '2026-09-01T10:00:00.000Z');

    expect(before).not.toBe(after);
    expect(before).toBe('/showcase/101-1-20260816152848638.png');
  });

  it('is a plain URL path — nothing needing escaping', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 999 }),
        fc.integer({ min: 1, max: 99 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2040-01-01'), noInvalidDate: true }),
        (page, subpage, when) => {
          const path = showcasePicturePath(page, subpage, when.toISOString());
          expect(path).toMatch(/^\/showcase\/[0-9-]+\.png$/);
          expect(encodeURI(path)).toBe(path);
        },
      ),
    );
  });

  it('keeps a page with a subpage apart from the page itself', () => {
    const version = '2026-08-16T15:28:48.638Z';
    expect(showcasePicturePath(101, 1, version)).not.toBe(
      showcasePicturePath(101, 2, version),
    );
  });
});

describe('showcaseVersionKey', () => {
  it('separates the same page at two versions', () => {
    expect(showcaseVersionKey(101, 1, 'a')).not.toBe(showcaseVersionKey(101, 1, 'b'));
  });

  it('separates two pages that share a version', () => {
    expect(showcaseVersionKey(101, 1, 'a')).not.toBe(showcaseVersionKey(102, 1, 'a'));
  });
});
