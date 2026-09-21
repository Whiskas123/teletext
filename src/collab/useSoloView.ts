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
  nextPageWithContent,
  normalizePage,
  pageWithContentFrom,
  prevPageWithContent,
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
  /**
   * Dial a Page_Number, landing on the next page with something on it when the
   * number itself is blank.
   *
   * What the keypad calls. {@link setDisplayedPage} is the literal move, for a
   * caller that has picked a particular screen and means it; this one is the
   * reader's request — "show me page 726" — and a blank 726 is not a page, so
   * the dial carries on to the first number after it that shows something. With
   * nothing anywhere to go to, the number is taken as dialled.
   */
  dialPage(n: number): SetDisplayedPageRejection | null;
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
  const [requestedPageNumber, setRequestedPageNumber] = useState(() =>
    inPageRange(initialPageNumber) ? initialPageNumber : DEFAULT_DISPLAYED_PAGE,
  );
  const [requestedSubpage, setRequestedSubpage] = useState(() =>
    normalizeSubpage(initialSubpage),
  );
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const { countOf } = useSubpages();

  /*
   * Whether the reader has been to a page of their own choosing yet.
   *
   * Until they have, the number the screen opened on is still a request rather
   * than a destination, and it gets the same rule the keypad gets below: the
   * URL `/watch/726` should no more sit on a blank 726 than a dialled 726
   * should. It cannot be applied where the state above is initialized, because
   * at that moment the document has not synced and every page looks empty —
   * so it is applied on the way out instead, and stops applying the moment the
   * reader touches a control.
   *
   * A URL that named a screen of a carousel (`/watch/220/3`) is exempt from the
   * start: it is a link somebody made to that screen, like a search result, and
   * the rule can only see the first screen of a page. Trusting the link is the
   * same choice {@link SoloViewApi.setDisplayedPage} makes for the same reason.
   */
  const [readerHasNavigated, setReaderHasNavigated] = useState(
    () => normalizeSubpage(initialSubpage) !== MIN_SUBPAGE,
  );

  /*
   * Derived rather than corrected after the fact: writing the resolved number
   * back into state from an effect would render the blank page first and then
   * replace it, which is a flash of exactly the screen this is here to avoid.
   * `?? requestedPageNumber` is the unsynced document again — see `dialPage`.
   */
  const displayedPageNumber = useMemo(
    () =>
      readerHasNavigated
        ? requestedPageNumber
        : (pageWithContentFrom(requestedPageNumber, pages ?? {}) ?? requestedPageNumber),
    [readerHasNavigated, requestedPageNumber, pages],
  );

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
      setRequestedPageNumber(n);
      setReaderHasNavigated(true);
      // A new page starts at the top of its carousel unless the caller asked
      // for a particular screen — arriving on subpage 3 because that is where
      // you left the last page would be nobody's intent.
      setRequestedSubpage(normalizeSubpage(target));
      return null;
    },
    [],
  );

  const dialPage = useCallback(
    (n: number): SetDisplayedPageRejection | null => {
      if (!inPageRange(n)) return 'out-of-range';
      // `?? n` rather than a refusal: `null` here means nothing in the service
      // shows anything, which is also what the document looks like before it
      // has synced. Honouring the number as dialled is the harmless answer —
      // the page fills in underneath if it turns out to have content.
      setRequestedPageNumber(pageWithContentFrom(n, pages ?? {}) ?? n);
      setReaderHasNavigated(true);
      setRequestedSubpage(MIN_SUBPAGE);
      return null;
    },
    [pages],
  );

  const goto = useCallback(
    (target: number | null): NavigationResult => {
      if (target === null) return 'none-available';
      setRequestedPageNumber(target);
      setReaderHasNavigated(true);
      setRequestedSubpage(MIN_SUBPAGE);
      return 'ok';
    },
    [],
  );

  const gotoNextNonEmpty = useCallback(
    (): NavigationResult => goto(nextPageWithContent(displayedPageNumber, pages ?? {})),
    [goto, displayedPageNumber, pages],
  );

  const gotoPrevNonEmpty = useCallback(
    (): NavigationResult => goto(prevPageWithContent(displayedPageNumber, pages ?? {})),
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
    dialPage,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
    stepSubpageBy,
  };
}
