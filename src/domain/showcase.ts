/**
 * Choosing what the front page shows on air.
 *
 * The front page has a page-shaped hole in it — a left column of identity and
 * navigation, and an empty right half — so what goes there is a teletext page,
 * not a picture of one. It is read from the same live document the viewer
 * reads, which is the point: the front page shows what is *actually* published
 * right now, and there is no second set of screenshots to go stale.
 *
 * Two rules decide what is eligible, and both matter:
 *
 * - **Only the curated range.** 700–999 is the open playground, which any
 *   visitor may write anything on (`domain/access.ts`). A front page is the one
 *   place that cannot be a surface for whatever was typed there a minute ago.
 * - **Only screens with ink.** A page claimed by a title or a directory heading
 *   is occupied but blank, and a blank rectangle showcases nothing.
 *
 * Pure and framework-free, so the eligibility rules and the rotation are
 * testable without a live document.
 */

import { isArchivePage } from './access';
import { parsePageKey, subpageCountOf, type SubpageCounts } from './subpages';
import { COLS, ROWS, type Cell } from '../types/teletext';

/**
 * How many distinct screens ride the strip.
 *
 * Capped rather than "all of them": the strip renders its screens twice so the
 * loop can be seamless, and each canvas holds a backing store, so an archive of
 * six hundred pages would be twelve hundred canvases. A dozen is more than fits
 * across any screen at once, which is all the strip can show anyway.
 */
export const SHOWCASE_STRIP = 12;

/** Seconds each screen takes to cross, so the speed is the same at any count. */
export const SHOWCASE_SECONDS_PER_SCREEN = 7;

/**
 * The wall on a narrow screen: four tiles, not nine.
 *
 * Two reasons, and they point the same way. A phone has no empty right half to
 * put nine pages in, so each tile came out at ~114px — a 40-column page at
 * under 3px per cell is a smear, not a page. And each tile is around 1,500 DOM
 * nodes, so nine of them cost 12,000 on the page a visitor meets first. Four
 * larger tiles read better and cost half as much.
 */
export const SHOWCASE_GRID_NARROW = 4;

/** Below this width the wall drops to {@link SHOWCASE_GRID_NARROW} tiles. */
export const SHOWCASE_WIDE_QUERY = '(min-width: 900px)';

/**
 * How long between one tile changing and the next.
 *
 * A tile at a time, round-robin, rather than the whole wall at once: nine pages
 * changing together is a flash that pulls the eye off the menu, while one in
 * nine is the flicker of a rack of monitors. At this interval the whole grid
 * has turned over in about twenty seconds.
 */
export const SHOWCASE_STEP_MS = 2200;

/** One screen the front page can show. */
export interface ShowcaseScreen {
  pageNumber: number;
  subpage: number;
  /** How many screens the page holds, for the header's `X/Y`. */
  subpageCount: number;
}

/**
 * Whether a stored cell map has anything drawn on it.
 *
 * The same test `useArchiveAdmin.livePage` applies: a character other than a
 * space, or any graphics. Clearing a page leaves its key behind, so presence in
 * the document is not evidence of content.
 */
export function hasInk(stored: unknown): boolean {
  if (stored == null || typeof stored !== 'object') return false;
  const cells = stored as Record<number, Cell | undefined>;
  for (let index = 0; index < COLS * ROWS; index += 1) {
    const cell = cells[index];
    if (cell == null) continue;
    if (cell.graphics != null) return true;
    if (typeof cell.char === 'string' && cell.char.trim().length > 0) return true;
  }
  return false;
}

/**
 * Every screen the front page may show, in page then subpage order.
 *
 * Takes the `pages` channel as it is stored — keys are page numbers, or
 * `"220.2"` for a subpage — so a carousel contributes each of its screens and
 * the rotation walks through them the way a set did.
 */
export function showcaseScreens(
  pages: Record<string, unknown> | null | undefined,
  counts: SubpageCounts | null | undefined,
): ShowcaseScreen[] {
  const screens: ShowcaseScreen[] = [];

  for (const [key, stored] of Object.entries(pages ?? {})) {
    const parsed = parsePageKey(key);
    if (parsed == null) continue;
    if (!isArchivePage(parsed.pageNumber)) continue;
    if (!hasInk(stored)) continue;
    screens.push({
      pageNumber: parsed.pageNumber,
      subpage: parsed.subpage,
      subpageCount: subpageCountOf(counts, parsed.pageNumber),
    });
  }

  return screens.sort(
    (a, b) => a.pageNumber - b.pageNumber || a.subpage - b.subpage,
  );
}

/**
 * Where the rotation starts, given a random number in `[0, 1)`.
 *
 * Random rather than always the lowest page number, so two visits do not open
 * on the same screen — the archive is 600 pages and a front page that always
 * shows 100 suggests there is only one. Deterministic in its argument, so the
 * test supplies the number instead of stubbing the global.
 */
export function startIndex(length: number, random: number): number {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const value = Number.isFinite(random) ? Math.min(0.999999, Math.max(0, random)) : 0;
  return Math.floor(value * length);
}

/** The screen after `index`, wrapping — a carousel of the whole archive. */
export function nextIndex(index: number, length: number): number {
  if (!Number.isInteger(length) || length <= 0) return 0;
  return (((index + 1) % length) + length) % length;
}

/**
 * Which screens ride the strip: a run beginning at a random place.
 *
 * Consecutive rather than scattered, so the strip reads as a stretch of the
 * service rather than a dozen unrelated pages — and consecutive is inherently
 * distinct, which is what stops the same page riding twice in one pass.
 *
 * Shorter than {@link SHOWCASE_STRIP} when the archive is: a strip of twelve
 * drawn from six pages would have to repeat, and the same page passing twice in
 * a row looks like a fault rather than a service.
 */
export function initialGrid(
  total: number,
  random: number,
  size: number = SHOWCASE_STRIP,
): number[] {
  const count = Math.min(size, Math.max(0, total));
  if (count <= 0) return [];
  const start = startIndex(total, random);
  return Array.from({ length: count }, (_, offset) => (start + offset) % total);
}
