/**
 * What one row of the page list says about its page.
 *
 * Gathered from three places — the live document (title, role, screens), the
 * publication records (source, bottom bar, shift) and the front-page strip —
 * into one flat value per page, so the list, the inspector and the filter all
 * read the same answer.
 */

import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import { headingLevel, type PageKind } from '../../domain/directory';
import { lineupGroupOf } from '../../domain/lineup';

/** What a page's bottom row is, across every archive screen it has. */
export type BarState =
  /** No archive screens, so nothing to choose: the row is whatever was drawn. */
  | { kind: 'hand-made' }
  /** The capture's own bottom row. */
  | { kind: 'own' }
  /** A saved bar, written over the bottom row on publish. */
  | { kind: 'menu'; id: number; name: string }
  /** Screens disagree. */
  | { kind: 'mixed' };

export interface PageRow {
  pageNumber: number;
  title: string;
  description: string;
  kind: PageKind;
  /** How many screens the page's carousel holds. */
  screens: number;
  /** How many of those were published from the archive. */
  archiveScreens: number;
  /** Where screen 1 came from, e.g. `RTP 220`, or null when made by hand. */
  source: string | null;
  topic: string | null;
  bar: BarState;
  /** Whether archive screens are shifted down a row; null with none. */
  shift: boolean | 'mixed' | null;
  /** Whether any screen is on the front page. */
  showcased: boolean;
  /** Whether any screen draws anything. */
  hasContent: boolean;
}

export interface RowSources {
  titleOf(pageNumber: number): string;
  descriptionOf(pageNumber: number): string;
  kindOf(pageNumber: number): PageKind;
  subpageCountOfPage(pageNumber: number): number;
  isShowcased(pageNumber: number, subpage: number): boolean;
  hasContent(pageNumber: number): boolean;
}

/** Records grouped by page, each group in screen order. */
export function recordsByPage(
  published: readonly PublishedEntry[],
): Map<number, PublishedEntry[]> {
  const map = new Map<number, PublishedEntry[]>();
  for (const entry of published) {
    const list = map.get(entry.page_number) ?? [];
    list.push(entry);
    map.set(entry.page_number, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.subpage ?? 1) - (b.subpage ?? 1));
  return map;
}

export function barOf(records: readonly PublishedEntry[]): BarState {
  if (records.length === 0) return { kind: 'hand-made' };
  const ids = new Set(records.map((entry) => entry.menu_id ?? null));
  if (ids.size > 1) return { kind: 'mixed' };
  const first = records[0];
  return first.menu_id == null
    ? { kind: 'own' }
    : { kind: 'menu', id: first.menu_id, name: first.menu_name ?? 'Saved bar' };
}

export function shiftOf(records: readonly PublishedEntry[]): PageRow['shift'] {
  if (records.length === 0) return null;
  const values = new Set(records.map((entry) => entry.shift_down));
  return values.size > 1 ? 'mixed' : records[0].shift_down;
}

export function describeBar(bar: BarState): string {
  switch (bar.kind) {
    case 'hand-made':
      return '—';
    case 'own':
      return 'Own row';
    case 'menu':
      return bar.name;
    case 'mixed':
      return 'Mixed';
  }
}

export function buildRow(
  pageNumber: number,
  records: readonly PublishedEntry[],
  sources: RowSources,
): PageRow {
  const screens = sources.subpageCountOfPage(pageNumber);
  const first = records.find((entry) => (entry.subpage ?? 1) === 1) ?? records[0];
  let showcased = false;
  for (let subpage = 1; subpage <= screens && !showcased; subpage += 1) {
    showcased = sources.isShowcased(pageNumber, subpage);
  }
  return {
    pageNumber,
    title: sources.titleOf(pageNumber),
    description: sources.descriptionOf(pageNumber),
    kind: sources.kindOf(pageNumber),
    screens,
    archiveScreens: records.length,
    source:
      first == null
        ? null
        : `${first.source.toUpperCase()} ${first.original_page}${first.sub ? `-${first.sub}` : ''}`,
    topic: first?.topic ?? null,
    bar: barOf(records),
    shift: shiftOf(records),
    showcased,
    hasContent: sources.hasContent(pageNumber),
  };
}

/** The filter above the list. */
export interface LineupFilter {
  text: string;
  source: 'all' | 'archive' | 'hand-made';
  /** A bar id as a string, `own`, or `all`. */
  bar: string;
  /** Only pages with no title. */
  untitled: boolean;
}

export const EMPTY_FILTER: LineupFilter = { text: '', source: 'all', bar: 'all', untitled: false };

export function isFiltering(filter: LineupFilter): boolean {
  return (
    filter.text.trim() !== '' || filter.source !== 'all' || filter.bar !== 'all' || filter.untitled
  );
}

/**
 * Whether a row survives the filter. The text matches the number or the title
 * as a substring, so `41` finds 410–419 as well as 141.
 */
export function matchesFilter(row: PageRow, filter: LineupFilter): boolean {
  if (filter.untitled && row.title.trim() !== '') return false;
  if (filter.source === 'archive' && row.archiveScreens === 0) return false;
  if (filter.source === 'hand-made' && row.archiveScreens > 0) return false;
  if (filter.bar === 'own' && row.bar.kind !== 'own') return false;
  if (filter.bar !== 'all' && filter.bar !== 'own') {
    if (row.bar.kind !== 'menu' || String(row.bar.id) !== filter.bar) return false;
  }
  const term = filter.text.trim().toLowerCase();
  if (term === '') return true;
  return (
    String(row.pageNumber).includes(term) ||
    row.title.toLowerCase().includes(term) ||
    (row.source ?? '').toLowerCase().includes(term)
  );
}

/** What each directory role is called on screen. */
export const KIND_NAMES: Record<PageKind, string> = {
  category: 'Category heading',
  subcategory: 'Subcategory heading',
  subsubcategory: 'Sub-subcategory heading',
  page: 'Page',
};

/** Where picked captures go, with numbers held as typed. */
export type AddDestination =
  | { mode: 'pages'; at: string }
  /** One new page, the picked captures its screens in order. */
  | { mode: 'story'; at: string }
  | { mode: 'screens'; page: string }
  | { mode: 'replace'; page: string; screen: string };

/** How picked captures are published. */
export interface AddSettings {
  menuId: number | null;
  shiftDown: boolean;
  kind: PageKind;
}

export const DEFAULT_ADD_SETTINGS: AddSettings = {
  menuId: null,
  // Most captures sit a row high for want of a header row, so shifting is the
  // common case and leaving it off meant remembering to tick it every time.
  shiftDown: true,
  kind: 'page',
};


/**
 * The pages each heading owns, by the Yellow Pages' own rule: everything after
 * it until the next heading at the same level or above (`domain/directory.ts`).
 * A heading never reaches across the 700 boundary into the other range.
 *
 * Only headings that own something are in the map — an empty heading has
 * nothing to collapse.
 */
export function headingSpans(
  pages: readonly number[],
  kindOf: (pageNumber: number) => PageKind,
): Map<number, number[]> {
  const sorted = [...pages].sort((a, b) => a - b);
  const spans = new Map<number, number[]>();
  sorted.forEach((heading, index) => {
    const level = headingLevel(kindOf(heading));
    if (level == null) return;
    const owned: number[] = [];
    for (const page of sorted.slice(index + 1)) {
      if (lineupGroupOf(page) !== lineupGroupOf(heading)) break;
      const other = headingLevel(kindOf(page));
      if (other != null && other <= level) break;
      owned.push(page);
    }
    if (owned.length > 0) spans.set(heading, owned);
  });
  return spans;
}
