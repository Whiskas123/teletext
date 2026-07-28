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
import { DEFAULT_DISPLAYED_PAGE, PAGES_CHANNEL } from './useRoomSync';
import type {
  NavigationResult,
  SetDisplayedPageRejection,
} from './useRoomSync';
import type { PagesData, TeletextPage } from './types';

export interface SoloViewApi {
  /** The Page_Number currently being watched. */
  displayedPageNumber: number;
  /** Normalized 960-cell page for the displayed Page_Number. */
  page: TeletextPage;
  /**
   * Change the displayed Page_Number. Applies and returns `null` for a valid
   * Page_Number; otherwise keeps the current page and returns the rejection.
   */
  setDisplayedPage(n: number): SetDisplayedPageRejection | null;
  /** Advance to the next higher non-empty page (wrapping 999 → 1). */
  gotoNextNonEmpty(): NavigationResult;
  /** Return to the next lower non-empty page (wrapping 1 → 999). */
  gotoPrevNonEmpty(): NavigationResult;
}

/**
 * Bind the solo watcher's local page selection to the global page content.
 *
 * @param initialPageNumber Page to open on, defaulting to page 100.
 */
export function useSoloView(
  initialPageNumber: number = DEFAULT_DISPLAYED_PAGE,
): SoloViewApi {
  const [displayedPageNumber, setDisplayedPageNumber] = useState(() =>
    inPageRange(initialPageNumber) ? initialPageNumber : DEFAULT_DISPLAYED_PAGE,
  );
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});

  const page = useMemo<TeletextPage>(
    () => normalizePage(pages ? pages[displayedPageNumber] : undefined),
    [pages, displayedPageNumber],
  );

  const setDisplayedPage = useCallback(
    (n: number): SetDisplayedPageRejection | null => {
      if (!inPageRange(n)) return 'out-of-range';
      setDisplayedPageNumber(n);
      return null;
    },
    [],
  );

  const gotoNextNonEmpty = useCallback((): NavigationResult => {
    const target = nextNonEmptyPage(displayedPageNumber, pages ?? {});
    if (target === null) return 'none-available';
    setDisplayedPageNumber(target);
    return 'ok';
  }, [displayedPageNumber, pages]);

  const gotoPrevNonEmpty = useCallback((): NavigationResult => {
    const target = prevNonEmptyPage(displayedPageNumber, pages ?? {});
    if (target === null) return 'none-available';
    setDisplayedPageNumber(target);
    return 'ok';
  }, [displayedPageNumber, pages]);

  return {
    displayedPageNumber,
    page,
    setDisplayedPage,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
  };
}
