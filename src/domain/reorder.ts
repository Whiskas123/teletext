/**
 * Renumbering pages.
 *
 * Page numbers are positions, not names: 200 is where the news starts because
 * that is where it was put. So slotting something in before an existing run, or
 * moving a whole section elsewhere, is ordinary editing — and doing it by hand
 * means republishing every page above, each one overwriting a live page on the
 * way past.
 *
 * ## Occupancy is every page, not every *published* page
 *
 * This plans against the pages that actually hold content, which is the union
 * of two stores: the archive publications recorded in Postgres, and everything
 * in the live playhtml document — seeded pages, pages people made by hand, the
 * open playground. Planning against the publication records alone was a real
 * bug: a hand-made page at 201 is invisible there, so shifting 200 up would
 * quietly overwrite it. A page nobody recorded is still a page.
 *
 * ## Order is the whole problem
 *
 * Moving 200→201 while 201 exists destroys 201. Every plan is therefore an
 * ordered sequence in which each destination is free at the moment it is
 * written, and callers must not reorder it. Where that is impossible — a
 * rotation, where every destination is occupied and no move can go first — the
 * plan lifts content out, slides the rest, and puts the held content back.
 *
 * Everything here is pure. The same plan is replayed against Postgres and
 * against playhtml, which cannot be updated atomically together, so both must
 * make identical moves rather than each deriving its own.
 */

import { PLAYGROUND_MIN_PAGE } from './access';
import { MAX_PAGE, MIN_PAGE } from './pageOps';

/** Lowest page a renumbering may use. */
export const MIN_ORDERABLE_PAGE = MIN_PAGE;
/** Highest page a renumbering may use. */
export const MAX_ORDERABLE_PAGE = MAX_PAGE;
/** First page of the open playground, where anyone may edit. */
export { PLAYGROUND_MIN_PAGE };

/** One page's renumbering. */
export interface PageMove {
  from: number;
  to: number;
}

/**
 * A renumbering, as both stores must replay it.
 *
 * `moves` alone cannot express every reorder. Moving 200 to 202 among
 * {200, 201, 202} is a rotation: 200 wants 202, 202 wants 201, 201 wants 200,
 * and every destination is occupied, so nothing is safe to do first. Hence
 * `lifts`: those pages' content is taken out and held, `moves` then run with
 * somewhere to go, and `drops` put the held content down at its new numbers.
 *
 * Replay strictly in this order: lifts, then moves in sequence, then drops.
 */
export interface ReorderPlan {
  /** Pages whose content is removed first and held aside. */
  lifts: number[];
  /** In-place moves, ordered so each destination is already free. */
  moves: PageMove[];
  /** Held content written to its new number; `from` identifies what was lifted. */
  drops: PageMove[];
}

/** Why a renumbering cannot be done. */
export type ReorderRejection =
  | 'nothing-to-move'
  | 'out-of-range'
  | 'blocked'
  | 'invalid-range';

export type PlanResult =
  | ({ ok: true } & ReorderPlan)
  | { ok: false; reason: ReorderRejection; blocking?: number[] };

/** Human-readable explanation, for the admin screen. */
export function describeReorderRejection(
  reason: ReorderRejection,
  blocking?: readonly number[],
): string {
  switch (reason) {
    case 'nothing-to-move':
      return 'No pages would move.';
    case 'out-of-range':
      return `That would push a page outside ${MIN_ORDERABLE_PAGE}–${MAX_ORDERABLE_PAGE}.`;
    case 'blocked':
      return blocking != null && blocking.length > 0
        ? `Pages already there: ${blocking.slice(0, 8).join(', ')}${
            blocking.length > 8 ? '…' : ''
          }. Make room first.`
        : 'Something is already there. Make room first.';
    case 'invalid-range':
      return `Page numbers must be between ${MIN_ORDERABLE_PAGE} and ${MAX_ORDERABLE_PAGE}, and a range must not end before it starts.`;
  }
}

function inRange(page: number): boolean {
  return (
    Number.isInteger(page) &&
    page >= MIN_ORDERABLE_PAGE &&
    page <= MAX_ORDERABLE_PAGE
  );
}

/** The occupied pages, de-duplicated, sanity-checked and sorted. */
function normalizeOccupied(occupied: readonly number[]): number[] {
  return [...new Set(occupied)]
    .filter((page) => Number.isInteger(page))
    .sort((a, b) => a - b);
}

/**
 * A shift, ordered so no move lands on a page still holding content.
 *
 * Ascending when moving down, descending when moving up — either way each
 * destination has been vacated by the step before it.
 */
function orderedShift(pages: readonly number[], delta: number): PageMove[] {
  const ordered = delta > 0 ? [...pages].sort((a, b) => b - a) : [...pages].sort((a, b) => a - b);
  return ordered.map((page) => ({ from: page, to: page + delta }));
}

/**
 * Push every occupied page at or above `fromPage` by `delta`.
 *
 * This is "make room": `planShift(occupied, 200, 3)` frees 200, 201 and 202 by
 * moving 200 and everything above it up three, so a run of new pages can go in
 * without touching any of them by hand.
 *
 * Because the whole tail moves together, nothing below `fromPage` can be hit —
 * the only way this fails is by running out of page numbers.
 */
export function planShift(
  occupied: readonly number[],
  fromPage: number,
  delta: number,
): PlanResult {
  if (!inRange(fromPage)) return { ok: false, reason: 'invalid-range' };
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, reason: 'nothing-to-move' };
  }

  const all = normalizeOccupied(occupied);
  const moving = all.filter((page) => page >= fromPage);
  if (moving.length === 0) return { ok: false, reason: 'nothing-to-move' };

  if (moving.some((page) => !inRange(page + delta))) {
    return { ok: false, reason: 'out-of-range' };
  }

  // Moving down can land on pages below `fromPage`, which are not moving.
  if (delta < 0) {
    const movingSet = new Set(moving);
    const stationary = new Set(all.filter((page) => !movingSet.has(page)));
    const blocking = moving.map((p) => p + delta).filter((p) => stationary.has(p));
    if (blocking.length > 0) return { ok: false, reason: 'blocked', blocking };
  }

  return { ok: true, lifts: [], moves: orderedShift(moving, delta), drops: [] };
}

/**
 * Move the block of pages in `[blockStart, blockEnd]` so it begins at
 * `destination`, sliding everything in between to close the gap behind it.
 *
 * This is list reordering, and it never needs the destination to be free: the
 * block's whole span of numbers travels, and the pages it passes over move the
 * other way by exactly that span. Moving 200–202 to 300 leaves 203–302 sitting
 * at 200–299 and the block at 300–302 — the same set of numbers, reordered.
 *
 * A single page is just a block of one, so this is the only move primitive.
 */
export function planMoveBlock(
  occupied: readonly number[],
  blockStart: number,
  blockEnd: number,
  destination: number,
): PlanResult {
  if (!inRange(blockStart) || !inRange(blockEnd) || !inRange(destination)) {
    return { ok: false, reason: 'invalid-range' };
  }
  if (blockEnd < blockStart) return { ok: false, reason: 'invalid-range' };

  const offset = destination - blockStart;
  if (offset === 0) return { ok: false, reason: 'nothing-to-move' };

  const all = normalizeOccupied(occupied);
  const lifts = all.filter((page) => page >= blockStart && page <= blockEnd);
  if (lifts.length === 0) return { ok: false, reason: 'nothing-to-move' };

  // The span of *numbers* the block occupies, which is what everything else
  // moves by — not the count of occupied pages, which may be sparse.
  const span = blockEnd - blockStart + 1;

  // Pages the block travels over, and which way they go to make room.
  const slide: number[] = [];
  if (offset > 0) {
    // Moving later: what lies above the block, up to the block's new end,
    // comes down by the block's span.
    const newEnd = blockEnd + offset;
    for (const page of all) {
      if (page > blockEnd && page <= newEnd) slide.push(page);
    }
    if (slide.some((page) => !inRange(page - span))) {
      return { ok: false, reason: 'out-of-range' };
    }
  } else {
    // Moving earlier: what lies below the block, down to its new start, goes up.
    for (const page of all) {
      if (page >= destination && page < blockStart) slide.push(page);
    }
    if (slide.some((page) => !inRange(page + span))) {
      return { ok: false, reason: 'out-of-range' };
    }
  }

  if (lifts.some((page) => !inRange(page + offset))) {
    return { ok: false, reason: 'out-of-range' };
  }

  return {
    ok: true,
    lifts,
    moves: orderedShift(slide, offset > 0 ? -span : span),
    drops: lifts.map((page) => ({ from: page, to: page + offset })),
  };
}

/** Move one page, sliding what it passes over. A block of one. */
export function planMove(
  occupied: readonly number[],
  fromPage: number,
  toPage: number,
): PlanResult {
  return planMoveBlock(occupied, fromPage, fromPage, toPage);
}

/**
 * Apply a plan to a set of page numbers, for previewing or asserting.
 * Mirrors what replaying it against a store does.
 */
export function applyPlan(
  occupied: readonly number[],
  plan: ReorderPlan,
): number[] {
  const result = new Set(normalizeOccupied(occupied));
  for (const page of plan.lifts) result.delete(page);
  for (const { from, to } of plan.moves) {
    result.delete(from);
    result.add(to);
  }
  for (const { to } of plan.drops) result.add(to);
  return [...result].sort((a, b) => a - b);
}

/** Every page a plan touches, for telling the operator what will change. */
export function affectedPages(plan: ReorderPlan): number[] {
  const pages = new Set<number>();
  for (const page of plan.lifts) pages.add(page);
  for (const { from, to } of plan.moves) {
    pages.add(from);
    pages.add(to);
  }
  for (const { to } of plan.drops) pages.add(to);
  return [...pages].sort((a, b) => a - b);
}
