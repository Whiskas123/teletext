// What a row says about its page: the bottom bar across screens, the shift,
// and what the filter above the list matches.

import { describe, expect, it } from 'vitest';

import type { PublishedEntry } from '../../collab/useArchiveAdmin';
import {
  barOf,
  buildRow,
  headingSpans,
  matchesFilter,
  recordsByPage,
  shiftOf,
  EMPTY_FILTER,
} from './lineupModel';

function record(page: number, subpage: number, menu: number | null, shift = true): PublishedEntry {
  return {
    page_number: page,
    subpage,
    capture_id: page * 10 + subpage,
    title: '',
    description: '',
    published_at: '',
    source: 'sic',
    original_page: 220,
    sub: '0002',
    topic: 'desporto',
    scheme: null,
    first_seen: null,
    manifest_title: null,
    shift_down: shift,
    menu_id: menu,
    menu_name: menu == null ? null : `Bar ${menu}`,
  };
}

const sources = {
  titleOf: (page: number) => (page === 204 ? 'Futebol' : ''),
  descriptionOf: () => '',
  kindOf: () => 'page' as const,
  subpageCountOfPage: () => 2,
  isShowcased: (_page: number, screen: number) => screen === 2,
  hasContent: () => true,
};

describe('the bottom bar of a page', () => {
  it('is the one every archive screen agrees on, or mixed', () => {
    expect(barOf([])).toEqual({ kind: 'hand-made' });
    expect(barOf([record(204, 1, null), record(204, 2, null)])).toEqual({ kind: 'own' });
    expect(barOf([record(204, 1, 3), record(204, 2, 3)])).toEqual({ kind: 'menu', id: 3, name: 'Bar 3' });
    expect(barOf([record(204, 1, 3), record(204, 2, null)])).toEqual({ kind: 'mixed' });
  });

  it('reports the shift the same way', () => {
    expect(shiftOf([])).toBeNull();
    expect(shiftOf([record(204, 1, null, false)])).toBe(false);
    expect(shiftOf([record(204, 1, null, true), record(204, 2, null, false)])).toBe('mixed');
  });
});

describe('a row', () => {
  it('names screen 1’s source and notices a later screen on the front page', () => {
    const records = recordsByPage([record(204, 2, null), record(204, 1, null)]).get(204)!;
    const row = buildRow(204, records, sources);
    expect(row.source).toBe('SIC 220-0002');
    expect(row.archiveScreens).toBe(2);
    expect(row.showcased).toBe(true);
  });

  it('matches the filter on number, title and source', () => {
    const row = buildRow(204, [record(204, 1, 3)], sources);
    expect(matchesFilter(row, { ...EMPTY_FILTER, text: '20' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, text: 'fut' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, text: 'sic 220' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, text: 'rtp' })).toBe(false);
    expect(matchesFilter(row, { ...EMPTY_FILTER, source: 'hand-made' })).toBe(false);
    expect(matchesFilter(row, { ...EMPTY_FILTER, bar: '3' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, bar: 'own' })).toBe(false);
  });
});

describe('what a heading owns', () => {
  const kinds: Record<number, 'category' | 'subcategory' | 'page'> = {
    101: 'category',
    102: 'subcategory',
    119: 'subcategory',
    130: 'category',
    699: 'category',
  };
  const kindOf = (page: number) => kinds[page] ?? 'page';
  const pages = [100, 101, 102, 103, 104, 119, 120, 130, 131, 699, 700];

  it('runs to the next heading at the same level or above', () => {
    const spans = headingSpans(pages, kindOf);
    expect(spans.get(101)).toEqual([102, 103, 104, 119, 120]);
    expect(spans.get(102)).toEqual([103, 104]);
    expect(spans.get(119)).toEqual([120]);
    expect(spans.get(130)).toEqual([131]);
  });

  it('never reaches into the playground, and leaves out empty headings', () => {
    const spans = headingSpans(pages, kindOf);
    expect(spans.has(699)).toBe(false);
  });
});
