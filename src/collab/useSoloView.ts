/**
 * useSoloView — the solo watcher's viewing state.
 *
 * The room equivalent, {@link useRoomSync}, keeps the displayed Page_Number in
 * a shared per-room channel so everyone in the room sees the same page, and
 * changing it needs a vote. Watching solo there is nobody to synchronize with:
 * the displayed Page_Number is plain local state and navigation applies
 * immediately.
 *
 * Page *content* still comes from the global `pages` channel, so a page edited
 * anywhere updates live on screen while it is being watched.
 *
 * All navigation decisions are delegated to the same pure helpers the room uses
 * (`src/domain/pageOps.ts`), so solo and room navigation behave identically.
 */

import { useCallback, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import {
  inPageRange,
  nextNonEmptyPage,
  normalizePage,
  prevNonEmptyPage,
} from '../domain/pageOps';
import {
  MIN_SUBPAGE,
  clampSubpage,
  normalizeSubpage,
  pageKey,
  stepSubpage,
} from '../domain/subpages';
import { DEFAULT_DISPLAYED_PAGE, PAGES_CHANNEL } from './useRoomSync';
import { useSubpages } from './useSubpages';
import type {
  NavigationResult,
  SetDisplayedPageRejection,
} from './useRoomSync';
import type { PagesData, TeletextPage } from './types';

export interface SoloViewApi {
  /** The Page_Number currently being watched. */
  displayedPageNumber: number;
  /** Which screen of that page's carousel is showing, from 1. */
  subpage: number;
  /** How many screens the displayed page holds. Always at least 1. */
  subpageCount: number;
  /** Normalized 960-cell page for the displayed Page_Number and subpage. */
  page: TeletextPage;
  /**
   * Change the displayed Page_Number. Applies and returns `null` for a valid
   * Page_Number; otherwise keeps the current page and returns the rejection.
   *
   * `subpage` may name a screen to land on, for a link or a search result that
   * points into the middle of a carousel; it defaults to the first.
   */
  setDisplayedPage(n: number, subpage?: number): SetDisplayedPageRejection | null;
  /** Advance to the next higher non-empty page (wrapping 999 → 1). */
  gotoNextNonEmpty(): NavigationResult;
  /** Return to the next lower non-empty page (wrapping 1 → 999). */
  gotoPrevNonEmpty(): NavigationResult;
  /** Step through the page's carousel, wrapping at both ends. */
  stepSubpageBy(delta: number): void;
}

/**
 * Bind the solo watcher's local page selection to the global page content.
 *
 * @param initialPageNumber Page to open on, defaulting to page 100.
 * @param initialSubpage Screen of that page to open on, defaulting to the first.
 */
export function useSoloView(
  initialPageNumber: number = DEFAULT_DISPLAYED_PAGE,
  initialSubpage: number = MIN_SUBPAGE,
): SoloViewApi {
  const [displayedPageNumber, setDisplayedPageNumber] = useState(() =>
    inPageRange(initialPageNumber) ? initialPageNumber : DEFAULT_DISPLAYED_PAGE,
  );
  const [requestedSubpage, setRequestedSubpage] = useState(() =>
    normalizeSubpage(initialSubpage),
  );
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const { countOf } = useSubpages();

  const subpageCount = countOf(displayedPageNumber);

  // Clamped on read rather than corrected in an effect: the count is shared
  // state, so a page can lose a subpage while it is being watched, and a
  // second render pass to fix up the number would briefly show a blank screen.
  const subpage = clampSubpage(requestedSubpage, subpageCount);

  const page = useMemo<TeletextPage>(
    () => normalizePage(pages ? pages[pageKey(displayedPageNumber, subpage) as number] : undefined),
    [pages, displayedPageNumber, subpage],
  );

  const setDisplayedPage = useCallback(
    (n: number, target: number = MIN_SUBPAGE): SetDisplayedPageRejection | null => {
      if (!inPageRange(n)) return 'out-of-range';
      setDisplayedPageNumber(n);
      // A new page starts at the top of its carousel unless the caller asked
      // for a particular screen — arriving on subpage 3 because that is where
      // you left the last page would be nobody's intent.
      setRequestedSubpage(normalizeSubpage(target));
      return null;
    },
    [],
  );

  const goto = useCallback(
    (target: number | null): NavigationResult => {
      if (target === null) return 'none-available';
      setDisplayedPageNumber(target);
      setRequestedSubpage(MIN_SUBPAGE);
      return 'ok';
    },
    [],
  );

  const gotoNextNonEmpty = useCallback(
    (): NavigationResult => goto(nextNonEmptyPage(displayedPageNumber, pages ?? {})),
    [goto, displayedPageNumber, pages],
  );

  const gotoPrevNonEmpty = useCallback(
    (): NavigationResult => goto(prevNonEmptyPage(displayedPageNumber, pages ?? {})),
    [goto, displayedPageNumber, pages],
  );

  const stepSubpageBy = useCallback(
    (delta: number) => {
      setRequestedSubpage((current) => stepSubpage(current, subpageCount, delta));
    },
    [subpageCount],
  );

  return {
    displayedPageNumber,
    subpage,
    subpageCount,
    page,
    setDisplayedPage,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
    stepSubpageBy,
  };
}
