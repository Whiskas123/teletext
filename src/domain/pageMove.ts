/**
 * Moving one page to a page number the operator names.
 *
 * The arrows nudge a page one place at a time, which is fine for tidying and
 * useless for "put this at 305". The reorder tools can do it, but only by
 * spelling out a block of one across three inputs. This is the same move said
 * once, from the card.
 *
 * ## It answers before it acts
 *
 * `planMove` in `reorder.ts` already knows exactly what a move does — including
 * that it *slides* what it passes over rather than needing the destination to be
 * free — so this asks it, rather than guessing at the rules a second time. The
 * operator sees the refusal, or how many other pages get a new number, before
 * pressing anything.
 *
 * ## Two rules layered on top of the plan
 *
 * The planner works on page numbers and knows nothing about who may edit them:
 *
 * - **A published page may not land at 700 or above.** `api/reorder.ts` refuses
 *   this, because 700–999 is editable by any visitor and `published_pages` is
 *   CHECKed to 100–699. Checked here too so the answer comes before the request.
 * - **A page crossing the boundary the other way is allowed, and said out loud.**
 *   Moving a hand-made page from 712 to 305 takes it out of its author's reach.
 *   The arrows refuse that, because one keypress is too easy to do by accident;
 *   naming a destination is deliberate, so it goes ahead with a note.
 *
 * Pure and framework-free.
 */

import { PLAYGROUND_MIN_PAGE } from './access';
import { MAX_PAGE, MIN_PAGE } from './pageOps';
import { describeReorderRejection, planMove } from './reorder';

export interface MoveRequest {
  /** Every page number holding something, from either store. */
  occupied: readonly number[];
  /** Page numbers that have a publication record. */
  published: ReadonlySet<number>;
  fromPage: number;
  destination: number;
}

export type MovePreview =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** Something true but easy to miss, or null. */
      note: string | null;
      /** Other pages that get a new number, ascending. */
      alsoMoved: number[];
    };

/** Whether a page number is one this screen can move a page to. */
export function isMoveTarget(destination: unknown): boolean {
  return (
    typeof destination === 'number' &&
    Number.isInteger(destination) &&
    destination >= MIN_PAGE &&
    destination <= MAX_PAGE
  );
}

/**
 * What moving `fromPage` to `destination` would do, or why it cannot be done.
 *
 * Total: never throws, whatever the numbers.
 */
export function previewMove({
  occupied,
  published,
  fromPage,
  destination,
}: MoveRequest): MovePreview {
  if (!isMoveTarget(destination)) {
    return {
      ok: false,
      reason: `A page number is between ${MIN_PAGE} and ${MAX_PAGE}.`,
    };
  }
  if (destination === fromPage) {
    return { ok: false, reason: `Page ${fromPage} is already there.` };
  }

  const plan = planMove(occupied, fromPage, destination);
  if (!plan.ok) {
    return { ok: false, reason: describeReorderRejection(plan.reason, plan.blocking) };
  }

  // Mirrors `api/reorder.ts`: no page with a publication record may end up in the
  // open playground, whether it is the page being moved or one it displaced.
  const strays = [...plan.moves, ...plan.drops]
    .filter(({ from, to }) => published.has(from) && to >= PLAYGROUND_MIN_PAGE)
    .map(({ to }) => to);
  if (strays.length > 0) {
    return {
      ok: false,
      reason:
        `That would put ${strays.length === 1 ? 'a published page' : 'published pages'} at ` +
        `${[...new Set(strays)].slice(0, 5).join(', ')}, in the open playground ` +
        `(${PLAYGROUND_MIN_PAGE}+) where any visitor could edit it.`,
    };
  }

  const alsoMoved = [
    ...new Set(
      [...plan.moves, ...plan.drops]
        .map(({ from }) => from)
        .filter((page) => page !== fromPage),
    ),
  ].sort((a, b) => a - b);

  return { ok: true, note: crossingNote(fromPage, destination), alsoMoved };
}

/**
 * Why a nudge in this direction is unavailable, or null when it can be made.
 *
 * Stricter than {@link previewMove} in one place, and deliberately so. A nudge is
 * one keypress, so it will not take a hand-made page across the playground
 * boundary — too easy to do by accident, and it silently changes who may edit the
 * page. Naming a destination is deliberate, so that route stays open.
 */
export function nudgeRefusal(
  pageNumber: number,
  delta: -1 | 1,
  published: boolean,
): string | null {
  const destination = pageNumber + delta;
  if (destination < MIN_PAGE) return `There is no page below ${MIN_PAGE}.`;
  if (destination > MAX_PAGE) return `There is no page above ${MAX_PAGE}.`;

  if (published && destination >= PLAYGROUND_MIN_PAGE) {
    return (
      `${PLAYGROUND_MIN_PAGE} and above is the open playground, where any ` +
      'visitor could edit this page.'
    );
  }
  if (
    !published &&
    pageNumber >= PLAYGROUND_MIN_PAGE &&
    destination < PLAYGROUND_MIN_PAGE
  ) {
    return (
      `Below ${PLAYGROUND_MIN_PAGE} is the curated range, where only a ` +
      'moderator may edit. Use “Move to…” to do this deliberately.'
    );
  }
  return null;
}

/** A boundary crossing worth pointing out, or null. */
function crossingNote(fromPage: number, destination: number): string | null {
  const wasPlayground = fromPage >= PLAYGROUND_MIN_PAGE;
  const goesPlayground = destination >= PLAYGROUND_MIN_PAGE;
  if (wasPlayground === goesPlayground) return null;

  return wasPlayground
    ? `This leaves the playground for the curated range, so only a moderator will be able to edit it.`
    : `This enters the playground (${PLAYGROUND_MIN_PAGE}+), where any visitor may edit it.`;
}

/** A one-line summary of what else changes, for the card. */
export function describeMovePreview(preview: MovePreview): string {
  if (!preview.ok) return preview.reason;
  const { alsoMoved, note } = preview;
  const count =
    alsoMoved.length === 0
      ? 'Nothing else moves.'
      : alsoMoved.length === 1
        ? `Page ${alsoMoved[0]} shifts to close the gap.`
        : `${alsoMoved.length} other pages shift to close the gap.`;
  return note == null ? count : `${count} ${note}`;
}
