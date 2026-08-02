/**
 * Property tests for renumbering published pages.
 *
 * The invariant that matters is that nothing is lost. A renumber replays the
 * same ordered moves against two stores that cannot be updated atomically
 * together, so a plan that overwrites a page part-way through would destroy it
 * in both. Hence the emphasis below on *order*: every destination must be free
 * at the moment it is written.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_ARCHIVE_PAGE,
  MIN_ARCHIVE_PAGE,
  applyPlan,
  describeReorderRejection,
  planMove,
  planShift,
  type ReorderPlan,
  type ReorderRejection,
} from './reorder';

/**
 * Replay a plan exactly as a store must, failing if any step would clobber a
 * live page or read one that is not there. This is the test that matters: the
 * same plan is replayed against Postgres and against playhtml, and a step that
 * overwrites a page destroys it in both.
 */
function replay(published: readonly number[], plan: ReorderPlan): Set<number> {
  const live = new Set(published);
  if (plan.lift != null) {
    expect(live.has(plan.lift), `lift ${plan.lift}: not live`).toBe(true);
    live.delete(plan.lift);
  }
  for (const { from, to } of plan.moves) {
    expect(live.has(from), `move ${from}->${to}: source is not live`).toBe(true);
    expect(live.has(to), `move ${from}->${to}: destination still occupied`).toBe(false);
    live.delete(from);
    live.add(to);
  }
  if (plan.drop != null) {
    expect(live.has(plan.drop), `drop ${plan.drop}: destination occupied`).toBe(false);
    live.add(plan.drop);
  }
  return live;
}

const arbPages = fc
  .uniqueArray(fc.integer({ min: MIN_ARCHIVE_PAGE, max: MAX_ARCHIVE_PAGE }), {
    minLength: 1,
    maxLength: 25,
  })
  .map((pages) => [...pages].sort((a, b) => a - b));

describe('planShift', () => {
  it('never emits a move onto a page that is still occupied', () => {
    fc.assert(
      fc.property(
        arbPages,
        fc.integer({ min: MIN_ARCHIVE_PAGE, max: MAX_ARCHIVE_PAGE }),
        fc.constantFrom(1, 2, 5, -1, -2),
        (pages, fromPage, delta) => {
          const plan = planShift(pages, fromPage, delta);
          if (!plan.ok) return;
          replay(pages, plan);
        },
      ),
    );
  });

  it('preserves the number of published pages', () => {
    fc.assert(
      fc.property(
        arbPages,
        fc.integer({ min: MIN_ARCHIVE_PAGE, max: MAX_ARCHIVE_PAGE }),
        fc.constantFrom(1, 2, -1),
        (pages, fromPage, delta) => {
          const plan = planShift(pages, fromPage, delta);
          if (!plan.ok) return;
          expect(applyPlan(pages, plan)).toHaveLength(pages.length);
        },
      ),
    );
  });

  it('frees the page it was asked to make room at', () => {
    const plan = planShift([200, 201, 202], 200, 1);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([200, 201, 202], plan)).toEqual([201, 202, 203]);
      // Descending, so 202 vacates 203 before 201 arrives, and so on.
      expect(plan.moves.map((m) => m.from)).toEqual([202, 201, 200]);
    }
  });

  it('leaves pages below the start alone', () => {
    const plan = planShift([100, 150, 200, 300], 200, 1);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([100, 150, 200, 300], plan)).toEqual([100, 150, 201, 301]);
    }
  });

  it('refuses to push a page past the end of the archive range', () => {
    const plan = planShift([MAX_ARCHIVE_PAGE], MAX_ARCHIVE_PAGE, 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('out-of-range');
  });

  it('refuses to shift down onto a page that is not moving', () => {
    // 199 stays put, so moving 200 down would overwrite it.
    const plan = planShift([199, 200, 201], 200, -1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('destination-occupied');
  });

  it('allows shifting down into free space', () => {
    const plan = planShift([200, 201], 200, -1);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([200, 201], plan)).toEqual([199, 200]);
      expect(plan.moves.map((m) => m.from)).toEqual([200, 201]);
    }
  });

  it('reports nothing to move rather than emitting an empty plan', () => {
    expect(planShift([100], 500, 1).ok).toBe(false);
    expect(planShift([100], 100, 0).ok).toBe(false);
  });

  it('never throws', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer()),
        fc.integer(),
        fc.integer(),
        (pages, fromPage, delta) => {
          expect(() => planShift(pages, fromPage, delta)).not.toThrow();
        },
      ),
    );
  });
});

describe('planMove', () => {
  it('never emits a move onto a page that is still occupied', () => {
    fc.assert(
      fc.property(arbPages, fc.nat(), fc.nat(), (pages, i, j) => {
        const fromPage = pages[i % pages.length];
        const toPage = pages[j % pages.length];
        const plan = planMove(pages, fromPage, toPage);
        if (!plan.ok) return;
        replay(pages, plan);
      }),
    );
  });

  it('keeps every page and moves the chosen one where asked', () => {
    fc.assert(
      fc.property(arbPages, fc.nat(), fc.nat(), (pages, i, j) => {
        const fromPage = pages[i % pages.length];
        const toPage = pages[j % pages.length];
        const plan = planMove(pages, fromPage, toPage);
        if (!plan.ok) return;
        const after = applyPlan(pages, plan);
        expect(after).toHaveLength(pages.length);
        expect(after).toContain(toPage);
      }),
    );
  });

  it('slides the block up when moving a page earlier', () => {
    const plan = planMove([200, 201, 202, 305], 305, 200);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([200, 201, 202, 305], plan)).toEqual([200, 201, 202, 203]);
      // 305 is lifted out first, the block slides up into the gap it leaves,
      // and only then is the held content dropped at 200.
      expect(plan.lift).toBe(305);
      expect(plan.drop).toBe(200);
    }
  });

  it('slides the block down when moving a page later', () => {
    const plan = planMove([200, 201, 202], 200, 202);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(applyPlan([200, 201, 202], plan)).toEqual([200, 201, 202]);
    }
  });

  it('refuses to move a page that is not published', () => {
    expect(planMove([200], 300, 100).ok).toBe(false);
  });

  it('refuses a move to where it already is', () => {
    expect(planMove([200], 200, 200).ok).toBe(false);
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), fc.integer(), (p, a, b) => {
        expect(() => planMove(p, a, b)).not.toThrow();
      }),
    );
  });
});

describe('describeReorderRejection', () => {
  it('has a message for every reason', () => {
    const reasons: ReorderRejection[] = [
      'nothing-to-move',
      'out-of-range',
      'destination-occupied',
      'invalid-page',
    ];
    for (const reason of reasons) {
      expect(describeReorderRejection(reason).length).toBeGreaterThan(0);
    }
  });
});
