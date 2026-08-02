/**
 * Renumbering published pages.
 *
 * Page numbers are positions, not names: 200 is where the news starts because
 * that is where it was put. So wanting to slot something in *before* an
 * existing run is normal, and doing it by hand means re-publishing every page
 * above it one at a time — which is both tedious and destructive, since each
 * one overwrites a live page on the way past.
 *
 * This works out the moves instead. It is pure, and deliberately separate from
 * both stores, because a renumber has to land in two places that cannot be
 * updated atomically together: `published_pages` in Postgres, and the `pages`
 * and `titles` channels in playhtml. Both replay the same ordered list.
 *
 * ## Order is the whole problem
 *
 * Moving 200→201 while 201 exists destroys 201. So moves are emitted in an
 * order where each destination is free at the moment it is written: descending
 * when shifting up, ascending when shifting down. Callers must not reorder them.
 */

import { MAX_PAGE } from './pageOps';
import { PLAYGROUND_MIN_PAGE } from './access';

/** Lowest page the archive may occupy. */
export const MIN_ARCHIVE_PAGE = 100;
/** Highest page the archive may occupy — the playground starts above it. */
export const MAX_ARCHIVE_PAGE = PLAYGROUND_MIN_PAGE - 1;

export { MAX_PAGE };

/** One page's renumbering, to be applied in the order given. */
export interface PageMove {
  from: number;
  to: number;
}

/**
 * A renumbering, as the stores must replay it.
 *
 * `moves` alone cannot express every reorder. Moving 200 to 202 among
 * {200, 201, 202} is a rotation: 200 wants 202, 202 wants 201, 201 wants 200,
 * and every destination is occupied, so no move is safe to do first. It needs
 * one page's content held aside while the rest slide.
 *
 * So a plan is: take `lift` out and hold it, apply `moves` in order (each
 * destination is free by then), then write what was held to `drop`. A plain
 * shift needs neither, and leaves both `null`.
 */
export interface ReorderPlan {
  /** Page whose content is removed first and held. */
  lift: number | null;
  /** In-place moves, in an order where each destination is already free. */
  moves: PageMove[];
  /** Where the held content is written, last. */
  drop: number | null;
}

/** Why a renumber cannot be done. */
export type ReorderRejection =
  | 'nothing-to-move'
  | 'out-of-range'
  | 'destination-occupied'
  | 'invalid-page';

export type PlanResult =
  | ({ ok: true } & ReorderPlan)
  | { ok: false; reason: ReorderRejection };

/** Human-readable explanation, for the admin screen. */
export function describeReorderRejection(reason: ReorderRejection): string {
  switch (reason) {
    case 'nothing-to-move':
      return 'No published pages would move.';
    case 'out-of-range':
      return `That would push a page outside ${MIN_ARCHIVE_PAGE}–${MAX_ARCHIVE_PAGE}.`;
    case 'destination-occupied':
      return 'A page is already there. Make room first, or shift the block instead.';
    case 'invalid-page':
      return `Page numbers must be between ${MIN_ARCHIVE_PAGE} and ${MAX_ARCHIVE_PAGE}.`;
  }
}

function inArchiveRange(page: number): boolean {
  return (
    Number.isInteger(page) && page >= MIN_ARCHIVE_PAGE && page <= MAX_ARCHIVE_PAGE
  );
}

/**
 * Shift every published page at or above `fromPage` by `delta`.
 *
 * This is the "make room" operation: `planShift(pages, 200, +1)` frees 200 by
 * pushing 200, 201, 202… up one each, so something new can be published there
 * without touching any of them by hand.
 */
export function planShift(
  published: readonly number[],
  fromPage: number,
  delta: number,
): PlanResult {
  if (!inArchiveRange(fromPage)) return { ok: false, reason: 'invalid-page' };
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, reason: 'nothing-to-move' };
  }

  const affected = [...new Set(published)]
    .filter((page) => Number.isInteger(page) && page >= fromPage)
    .sort((a, b) => a - b);

  if (affected.length === 0) return { ok: false, reason: 'nothing-to-move' };

  if (affected.some((page) => !inArchiveRange(page + delta))) {
    return { ok: false, reason: 'out-of-range' };
  }

  // Shifting down can land on a page below `fromPage` that is already taken —
  // those are not being moved, so they would simply be overwritten.
  if (delta < 0) {
    const moving = new Set(affected);
    const stationary = new Set(published.filter((page) => !moving.has(page)));
    if (affected.some((page) => stationary.has(page + delta))) {
      return { ok: false, reason: 'destination-occupied' };
    }
  }

  // Descending when moving up, ascending when moving down: either way each
  // destination has already been vacated by the time it is written.
  const ordered = delta > 0 ? [...affected].reverse() : affected;
  return {
    ok: true,
    lift: null,
    drop: null,
    moves: ordered.map((page) => ({ from: page, to: page + delta })),
  };
}

/**
 * Move one published page to another number, sliding the pages in between.
 *
 * The list-reordering operation: `planMove(pages, 305, 200)` puts 305 at 200 and
 * pushes what was at 200..304 up one, so nothing is lost and the relative order
 * of everything else is kept.
 */
export function planMove(
  published: readonly number[],
  fromPage: number,
  toPage: number,
): PlanResult {
  if (!inArchiveRange(fromPage) || !inArchiveRange(toPage)) {
    return { ok: false, reason: 'invalid-page' };
  }
  if (fromPage === toPage) return { ok: false, reason: 'nothing-to-move' };

  const pages = new Set(published);
  if (!pages.has(fromPage)) return { ok: false, reason: 'nothing-to-move' };

  const moves: PageMove[] = [];

  // The mover is lifted out first in both directions. That is what breaks the
  // cycle: with its page vacated, the block has somewhere to slide into, and
  // its own destination has been vacated by the time it is put back down.
  if (toPage < fromPage) {
    // Moving earlier: everything in [toPage, fromPage) slides up one, highest
    // first so each lands on a page the previous one just left.
    const between = [...pages]
      .filter((page) => page >= toPage && page < fromPage)
      .sort((a, b) => b - a);
    if (between.some((page) => !inArchiveRange(page + 1))) {
      return { ok: false, reason: 'out-of-range' };
    }
    for (const page of between) moves.push({ from: page, to: page + 1 });
  } else {
    // Moving later: everything in (fromPage, toPage] slides down one, lowest
    // first — the mover's own page is the first gap.
    const between = [...pages]
      .filter((page) => page > fromPage && page <= toPage)
      .sort((a, b) => a - b);
    if (between.some((page) => !inArchiveRange(page - 1))) {
      return { ok: false, reason: 'out-of-range' };
    }
    for (const page of between) moves.push({ from: page, to: page - 1 });
  }

  return { ok: true, lift: fromPage, moves, drop: toPage };
}

/**
 * Apply moves to a set of page numbers, for previewing or asserting a plan.
 * Mirrors what replaying the moves against a store does.
 */
export function applyPlan(
  published: readonly number[],
  plan: ReorderPlan,
): number[] {
  const result = new Set(published);
  if (plan.lift != null) result.delete(plan.lift);
  for (const { from, to } of plan.moves) {
    result.delete(from);
    result.add(to);
  }
  if (plan.drop != null) result.add(plan.drop);
  return [...result].sort((a, b) => a - b);
}
