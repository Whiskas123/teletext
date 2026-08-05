/**
 * Subpages — the several screens one page number holds.
 *
 * Real teletext had no way to make a page longer than 40x24, so a page with
 * more to say than fits was broadcast as a *carousel*: page 220 cycling through
 * 220-1, 220-2, 220-3 in the vertical blanking interval, each one a whole page
 * of its own. The header said which you were looking at and how many there
 * were. That is what this module models — and it is why the corpus itself has a
 * `sub` column: `571-0002` is the second screen of page 571, not a second page.
 *
 * ## The storage decision: a composite key, not a nested map
 *
 * Page content lives in playhtml's `pages` channel as
 * `{ [pageNumber]: { [cellIndex]: Cell } }`, and roughly a dozen modules read
 * it that way — the directory, the search, the occupancy check, the reordering
 * planner, the snapshot endpoint. Nesting a subpage level under each page
 * number would have meant changing every one of them, and migrating every
 * existing page.
 *
 * Instead, **subpage 1 keeps the plain page-number key it has always had**, and
 * subpages 2 and up get a composite key: `"220.2"`, `"220.3"`. So:
 *
 * - Nothing migrates. Every page in the document today is already its own
 *   subpage 1.
 * - Every existing reader keeps working untouched, and keeps meaning what it
 *   meant: `pages[220]` is what page 220 shows when you dial it.
 * - A reader that has no notion of subpages *skips* the composite keys rather
 *   than misreading them, because `Number("220.2")` is not an integer and every
 *   one of those readers already guards with `Number.isInteger`.
 *
 * ## How many subpages a page has is stored, not counted
 *
 * The count lives in its own channel ({@link SUBPAGE_COUNTS_CHANNEL}) rather
 * than being derived from which keys exist. Two reasons, both from playhtml:
 * a subpage that has just been added is empty, and would count as absent; and
 * playhtml's draft is a Proxy with no `deleteProperty` trap, so removing a
 * subpage can only blank its cells, never take the key away — a derived count
 * could go up but never down.
 *
 * Pure and framework-free, so the key format and the wrapping rules are
 * property-tested without a live document.
 */

import { toInteger } from './coerce';

/** Lowest subpage number. Subpage 1 *is* the page, and always exists. */
export const MIN_SUBPAGE = 1;

/**
 * Highest subpage a page may hold.
 *
 * Broadcast teletext allowed far more, but a carousel is read by pressing an
 * arrow, and 26 screens is already well past what anyone will page through.
 * The bound matters because the count is written by a client: without it, one
 * bad value would ask every reader to walk an arbitrary number of keys.
 */
export const MAX_SUBPAGE = 26;

/** Separator between page number and subpage in a composite key. */
const SEPARATOR = '.';

/** Stable playhtml channel id for the map of how many subpages each page has. */
export const SUBPAGE_COUNTS_CHANNEL = 'subpage-counts';

/** Subpage counts keyed by page number. An absent or invalid entry means 1. */
export type SubpageCounts = Record<number, number>;

/** The key a page's content is stored under in the `pages` channel. */
export type PageKey = string | number;

/**
 * Whether `n` is a usable subpage number: an integer in `1..MAX_SUBPAGE`.
 */
export function isSubpage(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= MIN_SUBPAGE && (n as number) <= MAX_SUBPAGE;
}

/**
 * Coerce anything into a valid subpage number, defaulting to
 * {@link MIN_SUBPAGE}.
 *
 * Out-of-range values are clamped rather than rejected: this reads a route
 * param and a shared document, and both can hold a stale number for a page
 * that has since lost subpages. Landing on the nearest real one beats showing
 * nothing.
 */
export function normalizeSubpage(raw: unknown): number {
  const value = toInteger(raw);
  if (value == null) return MIN_SUBPAGE;
  return Math.min(MAX_SUBPAGE, Math.max(MIN_SUBPAGE, value));
}

/** Coerce a stored subpage *count* into `1..MAX_SUBPAGE`. Same rules. */
export function normalizeSubpageCount(raw: unknown): number {
  return normalizeSubpage(raw);
}

/**
 * The `pages`-channel key for a given page and subpage.
 *
 * Subpage 1 returns the bare page **number**, which is the key every page in
 * the document already uses — so nothing needs migrating and every existing
 * reader keeps working. Subpages 2+ return the composite string form.
 */
export function pageKey(pageNumber: number, subpage: number = MIN_SUBPAGE): PageKey {
  const sub = normalizeSubpage(subpage);
  return sub <= MIN_SUBPAGE ? pageNumber : `${pageNumber}${SEPARATOR}${sub}`;
}

/**
 * Read a `pages`-channel key back into a page and subpage, or `null` when it is
 * neither form.
 *
 * `"220"` is page 220 subpage 1; `"220.3"` is page 220 subpage 3. Anything else
 * — a float, a negative, a subpage past {@link MAX_SUBPAGE}, junk — is `null`
 * rather than repaired, because the callers that parse keys are deciding what
 * to *store* (the backup, the renumbering replay) and a key they cannot read is
 * one they must not guess at.
 */
export function parsePageKey(key: string | number): {
  pageNumber: number;
  subpage: number;
} | null {
  const text = String(key);
  const dot = text.indexOf(SEPARATOR);

  if (dot === -1) {
    const pageNumber = toInteger(text);
    return pageNumber == null ? null : { pageNumber, subpage: MIN_SUBPAGE };
  }

  const pageNumber = toInteger(text.slice(0, dot));
  const subpage = toInteger(text.slice(dot + 1));
  if (pageNumber == null || subpage == null || !isSubpage(subpage)) return null;
  // `"220.1"` is spelled `"220"`. Accepting both would let one page's content
  // live under two keys, which no reader could reconcile.
  if (subpage === MIN_SUBPAGE) return null;
  return { pageNumber, subpage };
}

/** Every key a page's `count` subpages occupy, in order. */
export function pageKeys(pageNumber: number, count: number): PageKey[] {
  const total = normalizeSubpageCount(count);
  return Array.from({ length: total }, (_, index) => pageKey(pageNumber, index + 1));
}

/** Bring a subpage number inside `1..count`. */
export function clampSubpage(subpage: number, count: number): number {
  const total = normalizeSubpageCount(count);
  return Math.min(total, Math.max(MIN_SUBPAGE, normalizeSubpage(subpage)));
}

/**
 * Step `delta` subpages from `subpage`, wrapping at both ends.
 *
 * A carousel is a loop — that is the whole shape of the thing — so the last
 * subpage's "next" is the first. On a page with one subpage every step is a
 * no-op, which is why the arrows can stay enabled and simply do nothing rather
 * than appearing and disappearing as pages change.
 */
export function stepSubpage(subpage: number, count: number, delta: number): number {
  const total = normalizeSubpageCount(count);
  const current = clampSubpage(subpage, total);
  const step = toInteger(delta) ?? 0;
  return (((current - 1 + step) % total) + total) % total + 1;
}

/**
 * The `X/Y` the header shows beside the page number.
 *
 * Always rendered, including `1/1` on a page with no carousel: a set showed the
 * counter unconditionally, and an indicator that appears only sometimes reads
 * as a glitch rather than as information.
 */
export function formatSubpageIndicator(subpage: number, count: number): string {
  const total = normalizeSubpageCount(count);
  return `${clampSubpage(subpage, total)}/${total}`;
}

/** How many subpages `pageNumber` holds, per a stored counts map. */
export function subpageCountOf(
  counts: SubpageCounts | null | undefined,
  pageNumber: number,
): number {
  const raw = counts == null ? undefined : counts[pageNumber];
  return normalizeSubpageCount(raw);
}
