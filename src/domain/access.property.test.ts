/**
 * Tests for the archive/playground split and for finding a free page.
 *
 * The free-page rule matters because it decides where "Create a page" lands:
 * getting it wrong drops two people on the same number to overwrite each
 * other, which is exactly what defaulting to the first playground page did.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_PAGE } from './pageOps';
import { PLAYGROUND_MIN_PAGE, firstFreePlaygroundPage } from './access';

const arbOccupied = fc.uniqueArray(
  fc.integer({ min: PLAYGROUND_MIN_PAGE, max: MAX_PAGE }),
  { maxLength: 40 },
);

describe('firstFreePlaygroundPage', () => {
  it('starts at the bottom of the playground when nothing is taken', () => {
    expect(firstFreePlaygroundPage([])).toBe(PLAYGROUND_MIN_PAGE);
  });

  it('never returns a page that is taken', () => {
    fc.assert(
      fc.property(arbOccupied, (occupied) => {
        const free = firstFreePlaygroundPage(occupied);
        if (free != null) expect(occupied).not.toContain(free);
      }),
    );
  });

  it('always returns a playground page, never an archive one', () => {
    fc.assert(
      fc.property(arbOccupied, (occupied) => {
        const free = firstFreePlaygroundPage(occupied);
        if (free != null) {
          expect(free).toBeGreaterThanOrEqual(PLAYGROUND_MIN_PAGE);
          expect(free).toBeLessThanOrEqual(MAX_PAGE);
        }
      }),
    );
  });

  it('returns the lowest free page, not just any', () => {
    expect(firstFreePlaygroundPage([700, 701, 703])).toBe(702);
  });

  it('ignores archive pages entirely', () => {
    // The archive being full says nothing about the playground.
    const archive = Array.from({ length: 600 }, (_, i) => 100 + i);
    expect(firstFreePlaygroundPage(archive)).toBe(PLAYGROUND_MIN_PAGE);
  });

  it('reports a full playground rather than reusing a page', () => {
    const all = Array.from(
      { length: MAX_PAGE - PLAYGROUND_MIN_PAGE + 1 },
      (_, i) => PLAYGROUND_MIN_PAGE + i,
    );
    expect(firstFreePlaygroundPage(all)).toBeNull();
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (occupied) => {
        expect(() => firstFreePlaygroundPage(occupied)).not.toThrow();
      }),
    );
  });
});
