/**
 * What the snapshot endpoint accepts out of a posted document.
 *
 * `live_pages` is the copy of the playhtml document that this project owns —
 * playhtml keeps the real one on a third-party service with no export. So a
 * page the endpoint silently declines is a page that is not backed up, and the
 * failure is invisible until a restore comes up short.
 *
 * Subpages made that risk concrete. Their content lives under composite keys
 * (`"220.2"`), and every reader of the `pages` channel written before them
 * guards with `Number.isInteger` — which those keys deliberately fail. That
 * guard is correct everywhere else and would have been exactly wrong here: the
 * backup would have stored screen 1 of every carousel, reported success, and
 * dropped the rest.
 */

import { describe, expect, it } from 'vitest';

import { acceptable } from '../../api/snapshot';
import { pageToCellMap } from './pageEncoding';
import { createEmptyPage, COLS, type TeletextPage } from '../types/teletext';

/** A page with one recognisable word on it, so screens can be told apart. */
function pageSaying(text: string): TeletextPage {
  const page = createEmptyPage();
  for (let i = 0; i < text.length; i += 1) {
    page[COLS * 2 + i] = { char: text[i], fg: 'white', bg: 'black', graphics: null };
  }
  return page;
}

function bodyWith(pages: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { pages, titles: {}, kinds: {}, descriptions: {}, ...extra };
}

describe('snapshot acceptable', () => {
  it('stores every screen of a carousel, not just the first', () => {
    const { accepted, rejected } = acceptable(
      bodyWith(
        {
          220: pageToCellMap(pageSaying('ONE')),
          '220.2': pageToCellMap(pageSaying('TWO')),
          '220.3': pageToCellMap(pageSaying('THREE')),
        },
        { subpageCounts: { 220: 3 } },
      ),
    );

    expect(rejected).toBe(0);
    expect(accepted.map((row) => `${row.pageNumber}.${row.subpage}`).sort()).toEqual([
      '220.1',
      '220.2',
      '220.3',
    ]);
    // Every row carries the carousel's length, so a restore knows how many
    // screens the page had rather than inferring it from how many came back.
    expect(accepted.every((row) => row.subpageCount === 3)).toBe(true);
  });

  it('keeps a plain page number meaning the first screen', () => {
    const [row] = acceptable(bodyWith({ 412: pageToCellMap(createEmptyPage()) })).accepted;
    expect(row.pageNumber).toBe(412);
    expect(row.subpage).toBe(1);
    // No counts posted at all — every page in a document written before
    // carousels existed is a carousel of one.
    expect(row.subpageCount).toBe(1);
  });

  it('gives a page title, role and description to each of its screens', () => {
    // They belong to the page, not to one of its screens, so a restore can read
    // them off whichever row it happens to see first.
    const { accepted } = acceptable(
      bodyWith(
        {
          220: pageToCellMap(createEmptyPage()),
          '220.2': pageToCellMap(createEmptyPage()),
        },
        {
          titles: { 220: 'Desporto' },
          kinds: { 220: 'category' },
          descriptions: { 220: 'Results and tables' },
          subpageCounts: { 220: 2 },
        },
      ),
    );

    expect(accepted).toHaveLength(2);
    for (const row of accepted) {
      expect(row.title).toBe('Desporto');
      expect(row.kind).toBe('category');
      expect(row.description).toBe('Results and tables');
    }
  });

  it('rejects a key it cannot read rather than guessing a page from it', () => {
    // The backup is the copy of record: a key nobody can parse is a page nobody
    // could restore, and storing it under a guessed number is worse than not
    // storing it.
    const { accepted, rejected } = acceptable(
      bodyWith({
        '220.': pageToCellMap(createEmptyPage()),
        '220.0': pageToCellMap(createEmptyPage()),
        'not-a-page': pageToCellMap(createEmptyPage()),
        1200: pageToCellMap(createEmptyPage()),
      }),
    );

    expect(accepted).toEqual([]);
    expect(rejected).toBe(4);
  });

  it('does not let a bad count decide how much is stored', () => {
    // The count is written by a client. It shapes what a restore rebuilds, but
    // what gets *stored* is whichever screens were actually posted.
    const { accepted } = acceptable(
      bodyWith(
        { 220: pageToCellMap(createEmptyPage()), '220.2': pageToCellMap(createEmptyPage()) },
        { subpageCounts: { 220: 'plenty' } },
      ),
    );
    expect(accepted).toHaveLength(2);
    expect(accepted.every((row) => row.subpageCount === 1)).toBe(true);
  });
});
