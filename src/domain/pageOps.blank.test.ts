/**
 * Tests for the two kinds of empty a page can be.
 *
 * A page number was reachable with the PAGE keys and invisible on the
 * management screen at the same time, because navigation asked "does anything
 * here differ from the default cell?" while the management screen asked "is
 * there any ink?" — and a page of coloured spaces answers yes to the first and
 * no to the second. So the one page a reader could land on was the one page an
 * operator could not delete, and what the reader landed on was a blank screen.
 *
 * What is pinned down here is which question each side now asks:
 * {@link hasVisibleContent} for anything a reader can reach, and
 * {@link isNonEmptyPage} — the wider claim — for anything an operator has to be
 * able to find and clear.
 */

import { describe, expect, it } from 'vitest';

import {
  hasContentAt,
  hasVisibleContent,
  isNonEmptyPage,
  isVisibleCell,
  nextPageWithContent,
  pageWithContentFrom,
  prevPageWithContent,
} from './pageOps';
import { createEmptyPage, type Cell, type TeletextPage } from '../types/teletext';
import type { PagesData } from '../collab/types';

/** A page whose cell 0 is `cell` and whose other 959 cells are the default. */
function pageWith(cell: Cell): TeletextPage {
  const page = createEmptyPage();
  page[0] = cell;
  return page;
}

/** A `pages` channel holding each given page at its number. */
function pagesOf(entries: Record<number, TeletextPage>): PagesData {
  const pages: PagesData = {};
  for (const [number, page] of Object.entries(entries)) {
    pages[Number(number)] = { ...page };
  }
  return pages;
}

const LETTER: Cell = { char: 'A', fg: 'white', bg: 'black', graphics: null };
/** A space that was coloured and then left blank: the page 726 case. */
const YELLOW_SPACE: Cell = { char: ' ', fg: 'yellow', bg: 'black', graphics: null };
/** A mosaic cell with none of its six pixels lit. */
const UNLIT_MOSAIC: Cell = { char: ' ', fg: 'white', bg: 'black', graphics: 0 };
/** A coloured block — a space, but one that paints the cell red. */
const RED_BLOCK: Cell = { char: ' ', fg: 'white', bg: 'red', graphics: null };

describe('isVisibleCell', () => {
  it('sees a character, a lit mosaic and a coloured background', () => {
    expect(isVisibleCell(LETTER)).toBe(true);
    expect(isVisibleCell({ ...UNLIT_MOSAIC, graphics: 1 })).toBe(true);
    expect(isVisibleCell(RED_BLOCK)).toBe(true);
  });

  it('sees nothing in a space, however it is decorated', () => {
    expect(isVisibleCell(YELLOW_SPACE)).toBe(false);
    expect(isVisibleCell(UNLIT_MOSAIC)).toBe(false);
    expect(isVisibleCell({ ...YELLOW_SPACE, blink: true })).toBe(false);
    expect(isVisibleCell({ ...YELLOW_SPACE, doubleHeight: true })).toBe(false);
  });

  it('ignores the character under a mosaic, which is drawn instead of it', () => {
    expect(isVisibleCell({ ...LETTER, graphics: 0 })).toBe(false);
  });
});

describe('the two kinds of empty', () => {
  it('counts a coloured space as a claim on the number but not as a picture', () => {
    const page = pageWith(YELLOW_SPACE);
    expect(isNonEmptyPage(page)).toBe(true);
    expect(hasVisibleContent(page)).toBe(false);
  });

  it('agrees about a page with something drawn on it', () => {
    const page = pageWith(LETTER);
    expect(isNonEmptyPage(page)).toBe(true);
    expect(hasVisibleContent(page)).toBe(true);
  });

  it('agrees about a page that was cleared', () => {
    const page = createEmptyPage();
    expect(isNonEmptyPage(page)).toBe(false);
    expect(hasVisibleContent(page)).toBe(false);
  });
});

describe('stepping past a page that shows nothing', () => {
  const pages = pagesOf({
    200: pageWith(LETTER),
    726: pageWith(YELLOW_SPACE),
    730: pageWith(LETTER),
  });

  it('does not stop on it going up', () => {
    expect(nextPageWithContent(200, pages)).toBe(730);
  });

  it('does not stop on it coming down', () => {
    expect(prevPageWithContent(730, pages)).toBe(200);
  });

  it('is not fooled by an unlit mosaic either', () => {
    const doodled = pagesOf({ 200: pageWith(LETTER), 400: pageWith(UNLIT_MOSAIC) });
    expect(nextPageWithContent(200, doodled)).toBeNull();
  });

  it('stops on a page drawn entirely in coloured blocks', () => {
    const blocks = pagesOf({ 200: pageWith(LETTER), 400: pageWith(RED_BLOCK) });
    expect(nextPageWithContent(200, blocks)).toBe(400);
  });

  it('reports the same emptiness for a number nobody has ever touched', () => {
    expect(hasContentAt(pages, 726)).toBe(false);
    expect(hasContentAt(pages, 727)).toBe(false);
    expect(hasContentAt(pages, 730)).toBe(true);
  });
});

describe('pageWithContentFrom', () => {
  const pages = pagesOf({
    200: pageWith(LETTER),
    726: pageWith(YELLOW_SPACE),
    730: pageWith(LETTER),
  });

  it('leaves a number with a picture on it alone', () => {
    expect(pageWithContentFrom(200, pages)).toBe(200);
  });

  it('carries a blank number on to the next page with something on it', () => {
    expect(pageWithContentFrom(726, pages)).toBe(730);
    expect(pageWithContentFrom(727, pages)).toBe(730);
  });

  it('wraps past the end of the range', () => {
    expect(pageWithContentFrom(900, pages)).toBe(200);
  });

  it('refuses a number that is not a page', () => {
    expect(pageWithContentFrom(99, pages)).toBeNull();
    expect(pageWithContentFrom(1000, pages)).toBeNull();
  });

  it('has nowhere to send a dial when nothing shows anything', () => {
    // Which is also what an unsynced document looks like; the callers take
    // `null` as "keep the number as dialled" rather than as a refusal.
    expect(pageWithContentFrom(726, {})).toBeNull();
    expect(pageWithContentFrom(726, pagesOf({ 726: pageWith(YELLOW_SPACE) }))).toBeNull();
  });
});
