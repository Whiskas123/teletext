/**
 * The page list on `/manage`, and where things land when they are moved in it.
 *
 * Page numbers are positions, but they are not a dense array: a service is laid
 * out in sections — news from 100, sport from 200 — with free numbers between
 * them. So "put this page here" cannot mean one rule. The two primitives the
 * server already had show why:
 *
 * - a *slide* (`planMoveBlock`) shifts every page between the old and new
 *   position by one, which across a gap drags the head of the next section
 *   (300 becomes 301) along with it;
 * - a *swap* keeps everything else still but leaves the section order wrong.
 *
 * What an operator means by dragging a row depends on where the row goes, and
 * this module decides it:
 *
 * 1. **Reordering inside a run.** A run is a stretch of consecutive occupied
 *    numbers — a section with no holes. Dragging a page to another spot in the
 *    run it already belongs to reorders that run and keeps its numbers: the run
 *    stays exactly as long and exactly where it was.
 * 2. **Anywhere else, it is placed and the rest makes way.** The moving pages
 *    take consecutive numbers from the drop point, and a page already sitting
 *    on one of those numbers is pushed up — and so on, only until a free number
 *    absorbs the push. Nothing past the first gap moves.
 *
 * The result is an explicit mapping from old number to new, which
 * `planArrange` in `reorder.ts` checks and the server replays. Planning it here
 * means the screen can say exactly what will move before anything does.
 *
 * Pure and framework-free.
 */

import { PLAYGROUND_MIN_PAGE } from './access';
import { MAX_PAGE, MIN_PAGE } from './pageOps';
import type { PageMove } from './reorder';

/** The two ranges a page number can be in. */
export type LineupGroup = 'curated' | 'playground';

/** Where each range starts and ends. */
export const GROUP_BOUNDS: Readonly<Record<LineupGroup, { min: number; max: number }>> = {
  curated: { min: MIN_PAGE, max: PLAYGROUND_MIN_PAGE - 1 },
  playground: { min: PLAYGROUND_MIN_PAGE, max: MAX_PAGE },
};

/** Which range a page number is in. */
export function lineupGroupOf(pageNumber: number): LineupGroup {
  return pageNumber >= PLAYGROUND_MIN_PAGE ? 'playground' : 'curated';
}

/** One line of the list: a page, or a stretch of free numbers. */
export type LineupItem =
  | { type: 'page'; pageNumber: number }
  | { type: 'gap'; from: number; to: number };

/**
 * The list for one range: every occupied page, with the free stretches between
 * them — including before the first and after the last, which is where a new
 * section goes.
 */
export function lineupItems(
  occupied: readonly number[],
  group: LineupGroup,
): LineupItem[] {
  const { min, max } = GROUP_BOUNDS[group];
  const pages = sortedUnique(occupied).filter((page) => page >= min && page <= max);
  const items: LineupItem[] = [];

  let next = min;
  for (const pageNumber of pages) {
    if (pageNumber > next) items.push({ type: 'gap', from: next, to: pageNumber - 1 });
    items.push({ type: 'page', pageNumber });
    next = pageNumber + 1;
  }
  if (next <= max) items.push({ type: 'gap', from: next, to: max });
  return items;
}

/** Where dropped or moved pages should go. */
export type LineupTarget =
  /** Immediately after this page in the list. */
  | { kind: 'after'; pageNumber: number }
  /** Immediately before this page — used for the first page of a range. */
  | { kind: 'before'; pageNumber: number }
  /** Starting at this exact number, pushing up whatever is there. */
  | { kind: 'at'; pageNumber: number };

export interface ArrangeRequest {
  /** Every page number holding something, from either store. */
  occupied: readonly number[];
  /** Pages with a publication record, which may not enter the playground. */
  published: ReadonlySet<number>;
  /** Pages being moved. Their relative order is kept. */
  moving: readonly number[];
  /**
   * How many *new* pages need numbers ahead of the moving ones — captures
   * being added from the archive. They occupy the first numbers placed.
   */
  incoming?: number;
  target: LineupTarget;
}

export type ArrangePlan =
  | {
      ok: true;
      /** Every renumbering, identity moves left out. */
      moves: PageMove[];
      /** The numbers the new pages and then the moving pages end up on, in order. */
      placed: number[];
    }
  | { ok: false; reason: string };

/**
 * Work out every renumbering a move or an insert needs.
 *
 * Total: never throws, and anything it cannot do is refused with a reason
 * rather than done partly.
 */
export function planArrangement({
  occupied,
  published,
  moving: rawMoving,
  incoming = 0,
  target,
}: ArrangeRequest): ArrangePlan {
  const all = sortedUnique(occupied);
  const allSet = new Set(all);
  const moving = sortedUnique(rawMoving).filter((page) => allSet.has(page));
  const newCount = Math.max(0, Math.trunc(incoming));
  const count = moving.length + newCount;

  if (count === 0) return { ok: false, reason: 'Nothing to move.' };
  if (!Number.isInteger(target.pageNumber) || target.pageNumber < MIN_PAGE || target.pageNumber > MAX_PAGE) {
    return { ok: false, reason: `A page number is between ${MIN_PAGE} and ${MAX_PAGE}.` };
  }

  const movingSet = new Set(moving);
  if (target.kind !== 'at' && movingSet.has(target.pageNumber)) {
    return { ok: false, reason: 'Drop it next to a page that is not moving.' };
  }

  const stationary = all.filter((page) => !movingSet.has(page));

  // Reordering inside the run the pages already belong to keeps the run's
  // numbers. New pages always need numbers of their own, so they never do this.
  if (newCount === 0 && target.kind !== 'at') {
    const run = runAround(allSet, target.pageNumber);
    if (moving.every((page) => page >= run.start && page <= run.end)) {
      return finish(permuteRun(run, moving, target), moving, published, []);
    }
  }

  const start = startOf(target, count, new Set(stationary));
  const group = lineupGroupOf(start);
  const { max } = GROUP_BOUNDS[group];
  if (start + count - 1 > max) {
    return {
      ok: false,
      reason: `There are not ${count} numbers left between ${start} and ${max}.`,
    };
  }

  const placed = Array.from({ length: count }, (_, index) => start + index);
  const moves: PageMove[] = moving.map((from, index) => ({ from, to: placed[newCount + index] }));

  // The ripple: each stationary page in the way goes to the next free number,
  // and stops the moment one is not in the way.
  let next = start + count;
  for (const page of stationary) {
    if (page < start) continue;
    if (page >= next) break;
    if (next > max) {
      return {
        ok: false,
        reason: `Making room would push page ${page} past ${max}.`,
      };
    }
    moves.push({ from: page, to: next });
    next += 1;
  }

  return finish(moves, moving, published, placed.slice(0, newCount));
}

/**
 * Exchange two pages' numbers — the keyboard's "move up" and "move down",
 * where the neighbour is the next row in the list rather than the next number.
 */
export function planSwap(
  a: number,
  b: number,
  published: ReadonlySet<number>,
): ArrangePlan {
  if (a === b) return { ok: false, reason: 'Nothing to move.' };
  return finish(
    [
      { from: a, to: b },
      { from: b, to: a },
    ],
    [a],
    published,
    [],
  );
}

/**
 * The numbers `count` new pages would take if added at the end of a range —
 * the first free stretch after its last page, which is where "add" defaults.
 */
export function firstFreeRun(
  occupied: readonly number[],
  group: LineupGroup,
  count: number,
  from: number = GROUP_BOUNDS[group].min,
): number | null {
  const { max } = GROUP_BOUNDS[group];
  const taken = new Set(occupied);
  const need = Math.max(1, Math.trunc(count));
  let runStart = Math.max(from, GROUP_BOUNDS[group].min);
  for (let page = runStart; page <= max; page += 1) {
    if (taken.has(page)) {
      runStart = page + 1;
      continue;
    }
    if (page - runStart + 1 >= need) return runStart;
  }
  return null;
}

/**
 * What a plan does, in a sentence, naming the pages that are *not* the ones
 * being moved — those are the ones an operator is likely not to expect.
 */
export function describeArrangement(
  plan: ArrangePlan,
  moving: readonly number[],
  incoming = 0,
): string {
  if (!plan.ok) return plan.reason;

  const movingSet = new Set(moving);
  const placed = plan.placed.length > 0 ? plan.placed : destinationsOf(plan.moves, moving);
  const where = describeRange(placed);
  const lead =
    incoming > 0
      ? `Adds ${incoming === 1 ? 'a page' : `${incoming} pages`} at ${where}.`
      : placed.length === 0
        ? 'Nothing moves.'
        : moving.length === 1
          ? `Page ${moving[0]} becomes ${placed[0]}.`
          : `${moving.length} pages move to ${where}.`;

  const pushed = plan.moves.filter(({ from }) => !movingSet.has(from));
  if (pushed.length === 0) return `${lead} Nothing else is renumbered.`;
  const listed = pushed
    .slice(0, 4)
    .map(({ from, to }) => `${from}→${to}`)
    .join(', ');
  const more = pushed.length > 4 ? ` and ${pushed.length - 4} more` : '';
  return `${lead} Also renumbers ${listed}${more}.`;
}

/** `205`, or `205–208`, or `205, 207, 210` for a scattered set. */
export function describeRange(numbers: readonly number[]): string {
  const sorted = sortedUnique(numbers);
  if (sorted.length === 0) return '—';
  if (sorted.length === 1) return String(sorted[0]);
  const contiguous = sorted[sorted.length - 1] - sorted[0] === sorted.length - 1;
  if (contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  const head = sorted.slice(0, 5).join(', ');
  return sorted.length > 5 ? `${head}…` : head;
}

/** Follow a set of page numbers through a renumbering. */
export function remapPages(
  pages: Iterable<number>,
  moves: readonly PageMove[],
): number[] {
  const to = new Map(moves.map(({ from, to: dest }) => [from, dest]));
  return [...pages].map((page) => to.get(page) ?? page);
}

/* --- internals ---------------------------------------------------------- */

function sortedUnique(numbers: readonly number[]): number[] {
  return [...new Set(numbers)]
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/** The run of consecutive occupied numbers around `pageNumber`. */
function runAround(occupied: ReadonlySet<number>, pageNumber: number) {
  let start = pageNumber;
  let end = pageNumber;
  const group = lineupGroupOf(pageNumber);
  const { min, max } = GROUP_BOUNDS[group];
  while (start - 1 >= min && occupied.has(start - 1)) start -= 1;
  while (end + 1 <= max && occupied.has(end + 1)) end += 1;
  return { start, end };
}

/** Reorder a run in place: same numbers, moving pages at the drop point. */
function permuteRun(
  run: { start: number; end: number },
  moving: readonly number[],
  target: LineupTarget,
): PageMove[] {
  const movingSet = new Set(moving);
  const order: number[] = [];
  for (let page = run.start; page <= run.end; page += 1) {
    if (movingSet.has(page)) continue;
    if (target.kind === 'before' && page === target.pageNumber) order.push(...moving);
    order.push(page);
    if (target.kind === 'after' && page === target.pageNumber) order.push(...moving);
  }
  return order.map((from, index) => ({ from, to: run.start + index }));
}

/** Where a placement starts. */
function startOf(
  target: LineupTarget,
  count: number,
  stationary: ReadonlySet<number>,
): number {
  if (target.kind === 'at') return target.pageNumber;
  if (target.kind === 'after') return target.pageNumber + 1;

  // Before a page: into the free numbers just below it when there are enough,
  // so the page keeps its number; otherwise from the bottom of the range, and
  // the page makes way.
  const { min } = GROUP_BOUNDS[lineupGroupOf(target.pageNumber)];
  let start = target.pageNumber;
  while (start - 1 >= min && !stationary.has(start - 1) && target.pageNumber - start < count) {
    start -= 1;
  }
  return start;
}

function destinationsOf(moves: readonly PageMove[], moving: readonly number[]): number[] {
  const to = new Map(moves.map(({ from, to: dest }) => [from, dest]));
  return moving.map((page) => to.get(page) ?? page);
}

/** Drop identity moves and enforce the one rule the planner does not know. */
function finish(
  mapping: readonly PageMove[],
  moving: readonly number[],
  published: ReadonlySet<number>,
  placedNew: readonly number[],
): ArrangePlan {
  const moves = mapping.filter(({ from, to }) => from !== to);

  // Mirrors `api/reorder.ts`: an archive page may not land in the open
  // playground, where any visitor could edit it — whether it is the page being
  // moved or one it pushed.
  const strays = moves.filter(
    ({ from, to }) => published.has(from) && to >= PLAYGROUND_MIN_PAGE,
  );
  if (strays.length > 0) {
    return {
      ok: false,
      reason:
        `That would put archive page${strays.length === 1 ? '' : 's'} ` +
        `${strays.map(({ from }) => from).slice(0, 5).join(', ')} in the open playground ` +
        `(${PLAYGROUND_MIN_PAGE}+), where any visitor could edit ${strays.length === 1 ? 'it' : 'them'}.`,
    };
  }
  if (placedNew.some((page) => page >= PLAYGROUND_MIN_PAGE)) {
    return {
      ok: false,
      reason: `Archive captures can only be published to ${MIN_PAGE}–${PLAYGROUND_MIN_PAGE - 1}.`,
    };
  }

  const to = new Map(moves.map(({ from, to: dest }) => [from, dest]));
  return {
    ok: true,
    moves,
    placed: [...placedNew, ...moving.map((page) => to.get(page) ?? page)],
  };
}
