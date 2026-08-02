/**
 * Property tests for renumbering pages.
 *
 * The invariant that matters is that nothing is lost. A plan is replayed
 * against two stores that cannot be updated atomically together, so a step that
 * overwrites a page destroys it in both. Hence the emphasis on *order*: every
 * destination must be free at the moment it is written.
 *
 * `replay` below is the real test. It simulates a store exactly, and fails the
 * moment a step would read a page that is not there or write one that is.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_ORDERABLE_PAGE,
  MIN_ORDERABLE_PAGE,
  affectedPages,
  applyPlan,
  describeReorderRejection,
  planMove,
  planMoveBlock,
  planShift,
  type ReorderPlan,
  type ReorderRejection,
} from './reorder';

/** Replay a plan the way a store must, failing on any clobber or missing source. */
function replay(occupied: readonly number[], plan: ReorderPlan): Set<number> {
  const live = new Set(occupied);
  const held = new Set<number>();

  for (const page of plan.lifts) {
    expect(live.has(page), `lift ${page}: not live`).toBe(true);
    live.delete(page);
    held.add(page);
  }
  for (const { from, to } of plan.moves) {
    expect(live.has(from), `move ${from}->${to}: source is not live`).toBe(true);
    expect(live.has(to), `move ${from}->${to}: destination still occupied`).toBe(false);
    live.delete(from);
    live.add(to);
  }
  for (const { from, to } of plan.drops) {
    expect(held.has(from), `drop ${from}->${to}: nothing was lifted from ${from}`).toBe(true);
    expect(live.has(to), `drop ${from}->${to}: destination still occupied`).toBe(false);
    held.delete(from);
    live.add(to);
  }
  expect([...held], 'content was lifted and never put back').toEqual([]);
  return live;
}

const arbOccupied = fc
  .uniqueArray(fc.integer({ min: MIN_ORDERABLE_PAGE, max: MAX_ORDERABLE_PAGE }), {
    minLength: 1,
    maxLength: 30,
  })
  .map((pages) => [...pages].sort((a, b) => a - b));

const arbPage = fc.integer({ min: MIN_ORDERABLE_PAGE, max: MAX_ORDERABLE_PAGE });

describe('planShift — making room', () => {
  it('never clobbers, and never loses a page', () => {
    fc.assert(
      fc.property(
        arbOccupied,
        arbPage,
        fc.integer({ min: -20, max: 20 }),
        (occupied, fromPage, delta) => {
          const plan = planShift(occupied, fromPage, delta);
          if (!plan.ok) return;
          const after = replay(occupied, plan);
          expect(after.size).toBe(occupied.length);
        },
      ),
    );
  });

  it('opens exactly the gap it was asked for', () => {
    const plan = planShift([200, 201, 202], 200, 3);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([200, 201, 202], plan)).toEqual([203, 204, 205]);
    }
  });

  it('leaves everything below the start alone', () => {
    const plan = planShift([100, 150, 200, 300], 200, 1);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([100, 150, 200, 300], plan)).toEqual([100, 150, 201, 301]);
    }
  });

  it('counts pages nobody published as occupied', () => {
    // The bug this replaces: planning from the publication records alone meant
    // a hand-made page at 201 was invisible, and shifting 200 up overwrote it.
    const plan = planShift([200, 201], 201, -1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toBe('blocked');
      expect(plan.blocking).toEqual([200]);
    }
  });

  it('refuses to push a page past the end', () => {
    const plan = planShift([MAX_ORDERABLE_PAGE], MAX_ORDERABLE_PAGE, 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('out-of-range');
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), fc.integer(), (o, f, d) => {
        expect(() => planShift(o, f, d)).not.toThrow();
      }),
    );
  });
});

describe('planMoveBlock — moving a run of pages', () => {
  it('never clobbers, and never loses a page', () => {
    fc.assert(
      fc.property(arbOccupied, arbPage, arbPage, arbPage, (occupied, a, b, dest) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        const plan = planMoveBlock(occupied, start, end, dest);
        if (!plan.ok) return;
        const after = replay(occupied, plan);
        expect(after.size).toBe(occupied.length);
      }),
    );
  });

  it('moves a block later, closing the gap behind it', () => {
    const occupied = [200, 201, 202, 250, 300, 301];
    const plan = planMoveBlock(occupied, 200, 202, 300);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      // Everything the block passes over — 250, 300, 301 — comes down by its
      // span of 3, and the block lands on 300..302. Six pages in, six out.
      expect(applyPlan(occupied, plan)).toEqual([247, 297, 298, 300, 301, 302]);
    }
  });

  it('moves a block earlier, pushing what was there up', () => {
    const occupied = [200, 201, 300, 301, 302];
    const plan = planMoveBlock(occupied, 300, 302, 200);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      // The block takes 200-202; 200 and 201 move up by its span of 3.
      expect(applyPlan(occupied, plan)).toEqual([200, 201, 202, 203, 204]);
    }
  });

  it('needs no free space at the destination', () => {
    // The point of block moves: the destination being occupied is normal, and
    // handled by sliding, not by refusing.
    const occupied = [200, 201, 202];
    const plan = planMoveBlock(occupied, 200, 200, 202);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan(occupied, plan)).toEqual([200, 201, 202]);
      // A rotation: the mover has to be held while the others slide.
      expect(plan.lifts).toEqual([200]);
      expect(plan.drops).toEqual([{ from: 200, to: 202 }]);
    }
  });

  it('carries a sparse block without inventing pages', () => {
    const occupied = [200, 205, 400];
    const plan = planMoveBlock(occupied, 200, 210, 400);
    if (plan.ok) {
      const after = replay(occupied, plan);
      expect(after.size).toBe(3);
    }
  });

  it('refuses a backwards range', () => {
    const plan = planMoveBlock([200], 300, 200, 400);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('invalid-range');
  });

  it('reports nothing to move for an empty block', () => {
    expect(planMoveBlock([200], 300, 310, 400).ok).toBe(false);
    expect(planMoveBlock([200], 200, 200, 200).ok).toBe(false);
  });

  it('never throws', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer()),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (o, a, b, c) => {
          expect(() => planMoveBlock(o, a, b, c)).not.toThrow();
        },
      ),
    );
  });
});

describe('planMove — a block of one', () => {
  it('behaves as a single-page block move', () => {
    fc.assert(
      fc.property(arbOccupied, arbPage, arbPage, (occupied, from, to) => {
        expect(planMove(occupied, from, to)).toEqual(
          planMoveBlock(occupied, from, from, to),
        );
      }),
    );
  });
});

describe('affectedPages', () => {
  it('lists every page a plan touches', () => {
    const plan = planShift([200, 201], 200, 1);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(affectedPages(plan)).toEqual([200, 201, 202]);
  });
});

describe('describeReorderRejection', () => {
  it('has a message for every reason', () => {
    const reasons: ReorderRejection[] = [
      'nothing-to-move',
      'out-of-range',
      'blocked',
      'invalid-range',
    ];
    for (const reason of reasons) {
      expect(describeReorderRejection(reason).length).toBeGreaterThan(0);
    }
  });

  it('names the pages that are in the way', () => {
    expect(describeReorderRejection('blocked', [200, 201])).toContain('200, 201');
  });
});
