/**
 * What the solo set does with a number that has nothing on it.
 *
 * Dialling is the one route to a page that does not come from a list of pages
 * that exist — three digits, and the set goes. A number nobody has drawn on is
 * the gap between two pages rather than a page, so the dial carries on to the
 * next number that shows something; stopping there would put a blank screen up
 * and leave the reader to work out whether the set, the service or the page was
 * at fault.
 *
 * The document stands in for playhtml here: `usePageData` is the only door
 * `useSoloView` and `useSubpages` use onto it, so one mock serves both.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyPage, type Cell } from '../types/teletext';
import type { PagesData } from './types';

/** The document every case in this file reads, set by {@link withPages}. */
let channels: Record<string, unknown> = {};

vi.mock('@playhtml/react', () => ({
  usePageData: (channel: string, fallback: unknown) => [
    channels[channel] ?? fallback,
    vi.fn(),
  ],
  // Already synced, so the build's copy of the pages never stands in.
  usePlayContext: () => ({ isLoading: false }),
}));

const { useSoloView } = await import('./useSoloView');

const LETTER: Cell = { char: 'A', fg: 'white', bg: 'black', graphics: null };
/** A space that was coloured and then left blank: the page 726 case. */
const YELLOW_SPACE: Cell = { char: ' ', fg: 'yellow', bg: 'black', graphics: null };

/** Put the given pages in the document, each with its cell 0 set. */
function withPages(entries: Record<number, Cell>): void {
  const pages: PagesData = {};
  for (const [number, cell] of Object.entries(entries)) {
    const page = createEmptyPage();
    page[0] = cell;
    pages[Number(number)] = { ...page };
  }
  channels = { pages };
}

describe('dialling a page with nothing on it', () => {
  it('lands on the next page that shows something', () => {
    withPages({ 200: LETTER, 726: YELLOW_SPACE, 730: LETTER });
    const { result } = renderHook(() => useSoloView(200));

    act(() => {
      result.current.dialPage(726);
    });

    expect(result.current.displayedPageNumber).toBe(730);
  });

  it('goes straight to a number that has a picture on it', () => {
    withPages({ 200: LETTER, 730: LETTER });
    const { result } = renderHook(() => useSoloView(200));

    act(() => {
      result.current.dialPage(730);
    });

    expect(result.current.displayedPageNumber).toBe(730);
  });

  it('takes the number as dialled when nothing in the service shows anything', () => {
    // An unsynced document looks exactly like an empty one, and moving the
    // reader somewhere else on that evidence would be a guess.
    withPages({});
    const { result } = renderHook(() => useSoloView(200));

    act(() => {
      result.current.dialPage(726);
    });

    expect(result.current.displayedPageNumber).toBe(726);
  });

  it('refuses a number that is not a page, and stays put', () => {
    withPages({ 200: LETTER, 730: LETTER });
    const { result } = renderHook(() => useSoloView(200));

    let rejection: string | null = null;
    act(() => {
      rejection = result.current.dialPage(42);
    });

    expect(rejection).toBe('out-of-range');
    expect(result.current.displayedPageNumber).toBe(200);
  });
});

describe('opening on a page with nothing on it', () => {
  it('moves off the blank number the URL asked for', () => {
    withPages({ 200: LETTER, 726: YELLOW_SPACE, 730: LETTER });
    const { result } = renderHook(() => useSoloView(726));

    expect(result.current.displayedPageNumber).toBe(730);
  });

  it('stays on the screen a carousel link named', () => {
    // A link into the middle of a carousel is somebody's choice of screen, and
    // the dial's rule can only see the first screen of a page.
    withPages({ 200: LETTER, 726: YELLOW_SPACE, 730: LETTER });
    const { result } = renderHook(() => useSoloView(726, 3));

    expect(result.current.displayedPageNumber).toBe(726);
  });

  it('leaves the opening page alone once the reader is driving', () => {
    withPages({ 200: LETTER, 730: LETTER });
    const { result } = renderHook(() => useSoloView(200));

    act(() => {
      result.current.setDisplayedPage(726);
    });

    // `setDisplayedPage` is the literal move — a caller that means this page.
    // The opening resolve has had its one chance and must not undo it.
    expect(result.current.displayedPageNumber).toBe(726);
  });
});

describe('stepping with the PAGE keys', () => {
  it('skips a page that draws nothing', () => {
    withPages({ 200: LETTER, 726: YELLOW_SPACE, 730: LETTER });
    const { result } = renderHook(() => useSoloView(200));

    act(() => {
      result.current.gotoNextNonEmpty();
    });
    expect(result.current.displayedPageNumber).toBe(730);

    act(() => {
      result.current.gotoPrevNonEmpty();
    });
    expect(result.current.displayedPageNumber).toBe(200);
  });
});
