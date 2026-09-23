/**
 * Property tests for where moved pages land.
 *
 * The invariant that matters is the same as for every renumbering: nothing is
 * lost. A plan from `planArrangement` is checked by `planArrange` — the very
 * function the server runs — and replayed against a set of page numbers, and
 * the number of pages must come out the same.
 *
 * The rest pin down the two behaviours the list promises: a reorder inside a
 * run keeps that run's numbers, and a placement disturbs nothing beyond the
 * first free number.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  describeArrangement,
  describeRange,
  firstFreeRun,
  lineupItems,
  planArrangement,
  planSwap,
  remapPages,
  type LineupTarget,
} from './lineup';
import { applyPlan, planArrange } from './reorder';

const arbOccupied = fc.uniqueArray(fc.integer({ min: 100, max: 999 }), {
  minLength: 1,
  maxLength: 60,
});

/** A request whose moving pages and target come from the occupied set. */
const arbRequest = arbOccupied.chain((occupied) =>
  fc.record({
    occupied: fc.constant(occupied),
    moving: fc.subarray(occupied, { minLength: 1, maxLength: Math.min(5, occupied.length) }),
    target: fc.oneof(
      fc.record({
        kind: fc.constantFrom('after' as const, 'before' as const),
        pageNumber: fc.constantFrom(...occupied),
      }),
      fc.record({
        kind: fc.constant('at' as const),
        pageNumber: fc.integer({ min: 100, max: 999 }),
      }),
    ) as fc.Arbitrary<LineupTarget>,
  }),
);

describe('planArrangement', () => {
  it('never loses a page, and the server-side check agrees', () => {
    fc.assert(
      fc.property(arbRequest, ({ occupied, moving, target }) => {
        const plan = planArrangement({
          occupied,
          published: new Set(),
          moving,
          target,
        });
        if (!plan.ok || plan.moves.length === 0) return;

        const checked = planArrange(occupied, plan.moves);
        expect(checked.ok).toBe(true);
        if (!checked.ok) return;
        const after = applyPlan(occupied, checked);
        expect(after).toHaveLength(new Set(occupied).size);
        expect(after.every((page) => page >= 100 && page <= 999)).toBe(true);
      }),
    );
  });

  it('puts the moving pages on consecutive numbers, in their original order', () => {
    fc.assert(
      fc.property(arbRequest, ({ occupied, moving, target }) => {
        const plan = planArrangement({ occupied, published: new Set(), moving, target });
        if (!plan.ok) return;
        const sorted = [...new Set(moving)].sort((a, b) => a - b);
        const landed = remapPages(sorted, plan.moves);
        expect(landed).toEqual(plan.placed);
        for (let i = 1; i < landed.length; i += 1) {
          expect(landed[i]).toBeGreaterThan(landed[i - 1]);
        }
      }),
    );
  });

  it('reordering inside a run keeps exactly that run’s numbers', () => {
    // 200..209 is one run; 300 is far away and must not move.
    const occupied = [...Array.from({ length: 10 }, (_, i) => 200 + i), 300];
    const plan = planArrangement({
      occupied,
      published: new Set(),
      moving: [202],
      target: { kind: 'after', pageNumber: 206 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.moves).toEqual([
      { from: 203, to: 202 },
      { from: 204, to: 203 },
      { from: 205, to: 204 },
      { from: 206, to: 205 },
      { from: 202, to: 206 },
    ]);
    expect(applyPlan(occupied, { lifts: plan.moves.map((m) => m.from), moves: [], drops: plan.moves })).toEqual(occupied);
  });

  it('placing into another section pushes only as far as the first free number', () => {
    const occupied = [200, 201, 202, 203, 300, 301, 305];
    const plan = planArrangement({
      occupied,
      published: new Set(),
      moving: [305],
      target: { kind: 'after', pageNumber: 201 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 305 lands on 202; 202 and 203 make way; the 300s do not move.
    expect(new Map(plan.moves.map((m) => [m.from, m.to]))).toEqual(
      new Map([
        [305, 202],
        [202, 203],
        [203, 204],
      ]),
    );
  });

  it('a placement never moves a page below the drop point or past the ripple', () => {
    fc.assert(
      fc.property(arbRequest, ({ occupied, moving, target }) => {
        const plan = planArrangement({
          occupied,
          published: new Set(),
          moving,
          target: { kind: 'at', pageNumber: target.pageNumber },
        });
        if (!plan.ok) return;
        const movingSet = new Set(moving);
        for (const { from, to } of plan.moves) {
          if (movingSet.has(from)) continue;
          // A pushed page only ever goes up, and only by what was placed.
          expect(from).toBeGreaterThanOrEqual(target.pageNumber);
          expect(to).toBeGreaterThan(from);
        }
      }),
    );
  });

  it('makes room for new pages without moving anything that is not in the way', () => {
    const plan = planArrangement({
      occupied: [100, 101, 102, 110],
      published: new Set(),
      moving: [],
      incoming: 3,
      target: { kind: 'after', pageNumber: 100 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placed).toEqual([101, 102, 103]);
    expect(plan.moves).toEqual([
      { from: 101, to: 104 },
      { from: 102, to: 105 },
    ]);
  });

  it('uses the free numbers just before a page when adding before it', () => {
    const plan = planArrangement({
      occupied: [100, 110],
      published: new Set(),
      moving: [],
      incoming: 2,
      target: { kind: 'before', pageNumber: 110 },
    });
    expect(plan).toEqual({ ok: true, moves: [], placed: [108, 109] });
  });

  it('refuses to put an archive page in the playground, moved or pushed', () => {
    const pushed = planArrangement({
      occupied: [698, 699, 700],
      published: new Set([699]),
      moving: [],
      incoming: 1,
      target: { kind: 'at', pageNumber: 699 },
    });
    expect(pushed.ok).toBe(false);

    const moved = planArrangement({
      occupied: [205, 710],
      published: new Set([205]),
      moving: [205],
      target: { kind: 'after', pageNumber: 710 },
    });
    expect(moved.ok).toBe(false);
  });

  it('refuses rather than overflowing a range', () => {
    const plan = planArrangement({
      occupied: [697, 698, 699],
      published: new Set(),
      moving: [],
      incoming: 1,
      target: { kind: 'at', pageNumber: 697 },
    });
    expect(plan.ok).toBe(false);
  });
});

describe('planSwap', () => {
  it('exchanges two numbers and nothing else', () => {
    const plan = planSwap(204, 210, new Set());
    expect(plan).toEqual({
      ok: true,
      moves: [
        { from: 204, to: 210 },
        { from: 210, to: 204 },
      ],
      placed: [210],
    });
    if (plan.ok) expect(planArrange([204, 210], plan.moves).ok).toBe(true);
  });
});

describe('lineupItems', () => {
  it('covers every number in the range exactly once', () => {
    fc.assert(
      fc.property(arbOccupied, fc.constantFrom('curated' as const, 'playground' as const), (occupied, group) => {
        const items = lineupItems(occupied, group);
        let covered = 0;
        for (const item of items) {
          covered += item.type === 'page' ? 1 : item.to - item.from + 1;
        }
        expect(covered).toBe(group === 'curated' ? 600 : 300);
      }),
    );
  });
});

describe('firstFreeRun', () => {
  it('finds the first stretch long enough', () => {
    expect(firstFreeRun([100, 101, 103, 104], 'curated', 1)).toBe(102);
    expect(firstFreeRun([100, 101, 103, 104], 'curated', 2)).toBe(105);
    expect(firstFreeRun([100, 101, 103, 104], 'curated', 2, 200)).toBe(200);
  });
});

describe('describing a plan', () => {
  it('names what else is renumbered', () => {
    const plan = planArrangement({
      occupied: [200, 201, 202, 203, 300, 305],
      published: new Set(),
      moving: [305],
      target: { kind: 'after', pageNumber: 201 },
    });
    expect(describeArrangement(plan, [305])).toBe(
      'Page 305 becomes 202. Also renumbers 202→203, 203→204.',
    );
    expect(describeRange([205, 206, 207])).toBe('205–207');
    expect(describeRange([205, 207])).toBe('205, 207');
  });
});
