/**
 * Tests for moving one page to a named page number.
 *
 * The properties that matter: a preview never contradicts the plan the server
 * will make, a move never loses a page, and a published page never ends up
 * somewhere any visitor could edit it.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PLAYGROUND_MIN_PAGE } from './access';
import {
  describeMovePreview,
  isMoveTarget,
  nudgeRefusal,
  previewMove,
  type MoveRequest,
} from './pageMove';
import { applyPlan, planMove } from './reorder';

const arbOccupied = fc.uniqueArray(fc.integer({ min: 100, max: 999 }), {
  minLength: 1,
  maxLength: 25,
});

/** An occupied set, one of its pages, and somewhere to send it. */
const arbMove = arbOccupied.chain((occupied) =>
  fc.record({
    occupied: fc.constant(occupied),
    fromPage: fc.constantFrom(...occupied),
    destination: fc.integer({ min: 100, max: 999 }),
    published: fc
      .subarray(occupied)
      .map((pages) => new Set(pages.filter((p) => p < PLAYGROUND_MIN_PAGE))),
  }),
) as fc.Arbitrary<MoveRequest>;

describe('isMoveTarget', () => {
  it('accepts exactly the valid page numbers', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 1200 }), (value) => {
        expect(isMoveTarget(value)).toBe(value >= 100 && value <= 999);
      }),
    );
  });

  it('rejects anything that is not a whole number', () => {
    expect(isMoveTarget(204.5)).toBe(false);
    expect(isMoveTarget(Number.NaN)).toBe(false);
    expect(isMoveTarget('204')).toBe(false);
  });
});

describe('nudgeRefusal', () => {
  it('stops at both ends of the page range', () => {
    expect(nudgeRefusal(100, -1, false)).toMatch(/no page below/i);
    expect(nudgeRefusal(999, 1, false)).toMatch(/no page above/i);
  });

  it('allows an ordinary nudge either way', () => {
    fc.assert(
      fc.property(fc.integer({ min: 101, max: 698 }), (pageNumber) => {
        expect(nudgeRefusal(pageNumber, -1, true)).toBeNull();
        expect(nudgeRefusal(pageNumber, 1, true)).toBeNull();
      }),
    );
  });

  it('refuses to nudge a published page into the playground', () => {
    expect(nudgeRefusal(699, 1, true)).toMatch(/playground/i);
    expect(nudgeRefusal(699, 1, false)).toBeNull();
  });

  it('refuses to nudge a hand-made page out of the playground', () => {
    // Stricter than a named destination on purpose: one keypress should not
    // quietly move a visitor's page beyond their reach.
    expect(nudgeRefusal(PLAYGROUND_MIN_PAGE, -1, false)).toMatch(/curated range/i);
    expect(nudgeRefusal(PLAYGROUND_MIN_PAGE, 1, false)).toBeNull();
  });

  it('points at the deliberate route instead', () => {
    expect(nudgeRefusal(PLAYGROUND_MIN_PAGE, -1, false)).toMatch(/move to/i);
  });
});

describe('previewMove', () => {
  it('never throws, and always says something', () => {
    fc.assert(
      fc.property(arbMove, (request) => {
        const preview = previewMove(request);
        expect(describeMovePreview(preview).length).toBeGreaterThan(0);
      }),
    );
  });

  it('agrees with the planner about whether the move is possible', () => {
    fc.assert(
      fc.property(arbMove, (request) => {
        const preview = previewMove(request);
        const plan = planMove(request.occupied, request.fromPage, request.destination);

        // The preview may refuse a move the planner allows — the published-page
        // rule is ours, not the planner's — but never the other way round.
        if (preview.ok) expect(plan.ok).toBe(true);
      }),
    );
  });

  it('refuses to move a page onto itself', () => {
    fc.assert(
      fc.property(arbOccupied, (occupied) => {
        const preview = previewMove({
          occupied,
          published: new Set(),
          fromPage: occupied[0],
          destination: occupied[0],
        });
        expect(preview.ok).toBe(false);
      }),
    );
  });

  it('refuses a destination outside 100–999', () => {
    for (const destination of [99, 1000, 0, -1]) {
      const preview = previewMove({
        occupied: [204],
        published: new Set(),
        fromPage: 204,
        destination,
      });
      expect(preview.ok).toBe(false);
    }
  });

  it('keeps every page when the move it allows is applied', () => {
    fc.assert(
      fc.property(arbMove, (request) => {
        const preview = previewMove(request);
        fc.pre(preview.ok);

        const plan = planMove(request.occupied, request.fromPage, request.destination);
        fc.pre(plan.ok);

        const after = applyPlan(request.occupied, plan);
        // A reorder is a permutation of page numbers: nothing is lost, nothing
        // is invented, and the moved page is where it was sent.
        expect(after).toHaveLength([...new Set(request.occupied)].length);
        expect(after).toContain(request.destination);
      }),
    );
  });

  it('never lets a published page reach the playground', () => {
    fc.assert(
      fc.property(arbMove, (request) => {
        const preview = previewMove(request);
        fc.pre(preview.ok);

        const plan = planMove(request.occupied, request.fromPage, request.destination);
        fc.pre(plan.ok);

        for (const { from, to } of [...plan.moves, ...plan.drops]) {
          if (request.published.has(from)) {
            expect(to).toBeLessThan(PLAYGROUND_MIN_PAGE);
          }
        }
      }),
    );
  });

  it('refuses to send a published page into the playground, saying why', () => {
    const preview = previewMove({
      occupied: [204],
      published: new Set([204]),
      fromPage: 204,
      destination: 750,
    });

    expect(preview.ok).toBe(false);
    expect(describeMovePreview(preview)).toMatch(/playground/i);
  });

  it('allows a hand-made page across the boundary, with a note', () => {
    const preview = previewMove({
      occupied: [712],
      published: new Set(),
      fromPage: 712,
      destination: 305,
    });

    // Deliberate, unlike a nudge, so it goes ahead — but it changes who may edit
    // the page, and that is worth saying.
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.note).toMatch(/only a moderator/i);
  });

  it('notes the other direction too', () => {
    const preview = previewMove({
      occupied: [305],
      published: new Set(),
      fromPage: 305,
      destination: 712,
    });

    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.note).toMatch(/any visitor/i);
  });

  it('says nothing else moves when the destination is empty', () => {
    const preview = previewMove({
      occupied: [204],
      published: new Set(),
      fromPage: 204,
      destination: 500,
    });

    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.alsoMoved).toEqual([]);
    expect(describeMovePreview(preview)).toMatch(/nothing else moves/i);
  });

  it('names how many pages shift when it lands among others', () => {
    const preview = previewMove({
      occupied: [204, 205, 206, 207],
      published: new Set(),
      fromPage: 204,
      destination: 207,
    });

    expect(preview.ok).toBe(true);
    // 205, 206 and 207 all come down one to close the gap behind 204.
    if (preview.ok) expect(preview.alsoMoved).toEqual([205, 206, 207]);
    expect(describeMovePreview(preview)).toMatch(/3 other pages/);
  });

  it('reports one displaced page in the singular', () => {
    const preview = previewMove({
      occupied: [204, 205],
      published: new Set(),
      fromPage: 204,
      destination: 205,
    });

    expect(describeMovePreview(preview)).toMatch(/Page 205 shifts/);
  });
});
