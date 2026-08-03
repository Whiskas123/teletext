/**
 * The pages on air, grouped and filtered.
 *
 * The manage screen's list used to be every occupied page number in one
 * unbroken run — up to 900 cards, unsorted beyond ascending, with no way to
 * reach page 412 except scrolling. Two things fix that, and both are here
 * rather than in the component: a filter, and the split the service already
 * has.
 *
 * ## Two groups, because the ranges mean different things
 *
 * 100–699 is curated: only a moderator may place or edit content there, and it
 * is where archive publication lands. 700–999 is the open playground any
 * visitor may write to. A page's number already tells you which it is, so the
 * list says so out loud instead of leaving the operator to remember where the
 * boundary falls. The boundary itself comes from `isArchivePage` in `access.ts`
 * rather than an inline `>= 700`, so it has one definition.
 *
 * Published and hand-made is a separate question from which range a page sits
 * in: a hand-made page can be anywhere, while a published one is always
 * curated. Hence two independent restrictions rather than one list of kinds.
 *
 * Pure and framework-free, so the filtering and grouping rules are
 * property-tested without rendering a card.
 */

import { isArchivePage } from './access';

/** Whether the list is restricted to pages from the archive, or made by hand. */
export type PublicationRestriction = 'both' | 'published' | 'hand-made';

/** Whether the list is restricted to one of the two page-number ranges. */
export type RangeRestriction = 'both' | 'curated' | 'playground';

/** Which of the two groups a page belongs to. */
export type OnAirGroup = 'curated' | 'playground';

/**
 * Longest filter text accepted.
 *
 * Generous for what it filters — a page number is three characters and a title
 * sixty — but a bound rather than none, so a paste of something enormous cannot
 * turn every keystroke into a scan of a 900-character string.
 */
export const MAX_ON_AIR_FILTER = 64;

/** What the operator has narrowed the list to. */
export interface OnAirFilter {
  /** Matched against page number and title, trimmed and case-insensitively. */
  text: string;
  publication: PublicationRestriction;
  range: RangeRestriction;
}

/** Every page shown, nothing restricted. */
export const EMPTY_ON_AIR_FILTER: OnAirFilter = {
  text: '',
  publication: 'both',
  range: 'both',
};

/** One page on air, as the list needs to reason about it. */
export interface OnAirRow {
  pageNumber: number;
  group: OnAirGroup;
  /** The live title, or `''` when the page has none. */
  title: string;
  /** Whether a publication record exists for this page. */
  published: boolean;
  /** Whether the page holds any non-blank cell content. */
  hasContent: boolean;
}

/** The list as the panel renders it: two ascending groups, and the counts. */
export interface OnAirGroups {
  curated: OnAirRow[];
  playground: OnAirRow[];
  /** How many rows survived the filter. */
  shown: number;
  /** How many rows there were before it. */
  total: number;
}

/** Which group a page number falls in. */
export function groupOf(pageNumber: number): OnAirGroup {
  return isArchivePage(pageNumber) ? 'curated' : 'playground';
}

/** Clamp typed text to the accepted length, discarding the rest. */
export function clampFilterText(text: string): string {
  return typeof text === 'string' ? text.slice(0, MAX_ON_AIR_FILTER) : '';
}

/** Whether any restriction is narrower than "everything". */
export function isFiltering(filter: OnAirFilter): boolean {
  return (
    filter.text.trim().length > 0 ||
    filter.publication !== 'both' ||
    filter.range !== 'both'
  );
}

/**
 * Whether a row survives the filter.
 *
 * The text matches a page number written in decimal or a title, either as a
 * substring: typing `41` finds 410 through 419 as well as 141, which is the
 * behaviour you want when you half-remember a number. Leading and trailing
 * whitespace in the filter is ignored, so a stray space from a paste does not
 * empty the list.
 */
export function matchesOnAirFilter(row: OnAirRow, filter: OnAirFilter): boolean {
  if (filter.publication === 'published' && !row.published) return false;
  if (filter.publication === 'hand-made' && row.published) return false;
  if (filter.range !== 'both' && row.group !== filter.range) return false;

  const term = filter.text.trim().toLowerCase();
  if (term.length === 0) return true;

  return (
    String(row.pageNumber).includes(term) || row.title.toLowerCase().includes(term)
  );
}

/**
 * Build the two ascending groups from every page on air.
 *
 * `total` counts the rows given, not the rows shown, so the panel can say "12 of
 * 318" without deriving the same list twice. Each group is sorted here rather
 * than trusting the input order, so the result depends only on the page
 * numbers — the same property the reordering tools rely on.
 */
export function groupOnAirPages(
  rows: readonly OnAirRow[],
  filter: OnAirFilter,
): OnAirGroups {
  const curated: OnAirRow[] = [];
  const playground: OnAirRow[] = [];

  for (const row of rows) {
    if (!matchesOnAirFilter(row, filter)) continue;
    if (row.group === 'curated') curated.push(row);
    else playground.push(row);
  }

  const byPage = (a: OnAirRow, b: OnAirRow): number => a.pageNumber - b.pageNumber;
  curated.sort(byPage);
  playground.sort(byPage);

  return {
    curated,
    playground,
    shown: curated.length + playground.length,
    total: rows.length,
  };
}
