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

import { shuffleBySeed } from './showcase';

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
