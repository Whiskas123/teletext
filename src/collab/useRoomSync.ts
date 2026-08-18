/**
 * useRoomSync — playhtml binding hook for the room's synchronized viewing state
 * (Requirement 3).
 *
 * The Room_Sync_Service keeps a single currently-displayed Page_Number shared by
 * all members of a room, and exposes the normalized 960-cell {@link TeletextPage}
 * for that page. All decision logic is delegated to the pure, framework-free
 * helpers in `src/domain/pageOps.ts`; this hook only binds them to playhtml's
 * synced state.
 *
 * ## Binding approach: hook, not HOC
 *
 * `@playhtml/react` exports `withSharedState` as a higher-order *component*
 * (render-prop HOC), which cannot be consumed from a plain hook. It also exports
 * `usePageData<T>(name, defaultValue): [T, setData]`, a `useState`-like hook over
 * a named, synced, persisted JSON channel (verified against the installed
 * `@playhtml/react` 2.0.1 type definitions). Because `useRoomSync` needs to read
 * and write *two* channels (`room-sync` and `pages`) and expose imperative
 * actions, the hook form via `usePageData` is the natural fit — no HOC wrapper is
 * required.
 *
 * The `setData` returned by `usePageData` accepts either a next value or an
 * immer-style `(draft) => void` mutator. We use the mutator form for writes so
 * that concurrent updates merge in a Yjs-friendly way.
 *
 * Channels (stable ids):
 * - `"room-sync"` → {@link RoomSyncData} (default `{ displayedPageNumber: 100 }`)
 * - `"pages"`     → {@link PagesData} (default `{}`)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 7.4.
 */

import { useCallback, useMemo } from 'react';
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
  pageKey,
  stepSubpage,
} from '../domain/subpages';
import { useRoomId } from './RoomContext';
import { useSubpages } from './useSubpages';
import type { PagesData, RoomSyncData, TeletextPage } from './types';

/**
 * Base id for a room's synchronized display channel. The effective channel is
 * keyed per Room_ID (`room-sync:${roomId}`) inside the single global document.
 */
export const ROOM_SYNC_CHANNEL = 'room-sync';
/** Build the per-room synchronized-display channel id. */
export const roomSyncChannel = (roomId: string): string =>
  `${ROOM_SYNC_CHANNEL}:${roomId}`;
/** Stable playhtml channel id for the GLOBAL map of page content. */
export const PAGES_CHANNEL = 'pages';

/** Default displayed Page_Number when a room has no sync state yet (Req 3.4). */
export const DEFAULT_DISPLAYED_PAGE = 100;

/**
 * Reason a {@link RoomSyncApi.setDisplayedPage} request was rejected. Currently
 * the only rejection is an out-of-range target (Req 3.5).
 */
export type SetDisplayedPageRejection = 'out-of-range';

/** Result of a next/previous navigation request (Req 3.6, 3.7, 3.8). */
export type NavigationResult = 'ok' | 'none-available';

export interface RoomSyncApi {
  /** The room's currently displayed Page_Number (defaults to 100 when unset). */
  displayedPageNumber: number;
  /**
   * Which screen of that page's carousel the room is on, from 1.
   *
   * Shared like the page number, so a room watching page 220 is watching the
   * same *screen* of it — but changed without a vote, unlike the page number.
   * A vote decides what the room is watching; stepping through the screens of
   * the page it already agreed on is reading it, not changing it.
   */
  displayedSubpage: number;
  /** How many screens the displayed page holds. Always at least 1. */
  subpageCount: number;
  /** Normalized 960-cell page for the displayed Page_Number (Req 7.4). */
  page: TeletextPage;
  /**
   * Request a change to the displayed Page_Number.
   *
   * Applies the change and returns `null` when `n` is a valid Page_Number
   * (integer 1..999); otherwise retains the current page and returns a rejection
   * reason (Req 3.1, 3.2, 3.5).
   */
  setDisplayedPage(n: number): SetDisplayedPageRejection | null;
  /**
   * Set the displayed Page_Number directly, without range validation.
   *
   * Intended for callers that have already validated the target — notably the
   * voting flow applying an accepted Change_Request's target. Prefer
   * {@link setDisplayedPage} for user-driven navigation.
   */
  setDisplayedPageDirect(n: number): void;
  /**
   * Advance to the next higher Non_Empty_Page (wrapping 999 → 1), skipping empty
   * pages. Returns `'none-available'` and retains the current page when no other
   * Non_Empty_Page exists (Req 3.6, 3.8).
   */
  gotoNextNonEmpty(): NavigationResult;
  /**
   * Return to the next lower Non_Empty_Page (wrapping 1 → 999), skipping empty
   * pages. Returns `'none-available'` and retains the current page when no other
   * Non_Empty_Page exists (Req 3.7, 3.8).
   */
  gotoPrevNonEmpty(): NavigationResult;
  /**
   * The page {@link gotoNextNonEmpty} would move to, without moving to it, or
   * `null` when there is no other Non_Empty_Page.
   *
   * For a caller that has to *propose* the step rather than take it — the room's
   * front panel, where the page is the vote's to decide.
   */
  peekNextNonEmpty(): number | null;
  /** The page {@link gotoPrevNonEmpty} would move to. See {@link peekNextNonEmpty}. */
  peekPrevNonEmpty(): number | null;
  /** Step the whole room through the page's carousel, wrapping at both ends. */
  stepSubpageBy(delta: number): void;
}

/**
 * Bind the room's synchronized viewing state to playhtml.
 *
 * Reads the shared displayed Page_Number and page content, and returns
 * imperative actions to change the displayed page. Navigation and range
 * decisions are delegated to `src/domain/pageOps.ts`.
 */
export function useRoomSync(): RoomSyncApi {
  const roomId = useRoomId();
  const [sync, setSync] = usePageData<RoomSyncData>(roomSyncChannel(roomId), {
    displayedPageNumber: DEFAULT_DISPLAYED_PAGE,
  });
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const { countOf } = useSubpages();

  // Guard against a malformed/absent sync value (e.g. before first sync), so the
  // default page 100 is always presented (Req 3.4).
  const displayedPageNumber =
    sync && Number.isInteger(sync.displayedPageNumber)
      ? sync.displayedPageNumber
      : DEFAULT_DISPLAYED_PAGE;

  const subpageCount = countOf(displayedPageNumber);
  // Clamped on read, like the page number is guarded: a room can be sitting on
  // screen 3 of a carousel an editor then shortens to two.
  const displayedSubpage = clampSubpage(sync?.displayedSubpage ?? MIN_SUBPAGE, subpageCount);

  // Normalize the stored page (or absent entry) to a valid 960-cell page (Req 7.4).
  const page = useMemo<TeletextPage>(
    () =>
      normalizePage(
        pages ? pages[pageKey(displayedPageNumber, displayedSubpage) as number] : undefined,
      ),
    [pages, displayedPageNumber, displayedSubpage],
  );

  const setDisplayedPageDirect = useCallback(
    (n: number) => {
      setSync((draft) => {
        draft.displayedPageNumber = n;
        // A new page starts at the top of its carousel. Without this, an
        // accepted vote for a one-screen page while the room sat on screen 3
        // would land everyone on a subpage that page does not have.
        draft.displayedSubpage = MIN_SUBPAGE;
      });
    },
    [setSync],
  );

  const stepSubpageBy = useCallback(
    (delta: number) => {
      setSync((draft) => {
        draft.displayedSubpage = stepSubpage(
          draft.displayedSubpage ?? MIN_SUBPAGE,
          subpageCount,
          delta,
        );
      });
    },
    [setSync, subpageCount],
  );

  const setDisplayedPage = useCallback(
    (n: number): SetDisplayedPageRejection | null => {
      if (!inPageRange(n)) return 'out-of-range';
      setDisplayedPageDirect(n);
      return null;
    },
    [setDisplayedPageDirect],
  );

  const gotoNextNonEmpty = useCallback((): NavigationResult => {
    const target = nextNonEmptyPage(displayedPageNumber, pages ?? {});
    if (target === null) return 'none-available';
    setDisplayedPageDirect(target);
    return 'ok';
  }, [displayedPageNumber, pages, setDisplayedPageDirect]);

  const gotoPrevNonEmpty = useCallback((): NavigationResult => {
    const target = prevNonEmptyPage(displayedPageNumber, pages ?? {});
    if (target === null) return 'none-available';
    setDisplayedPageDirect(target);
    return 'ok';
  }, [displayedPageNumber, pages, setDisplayedPageDirect]);

  /*
   * Where the step keys *would* go, without going there.
   *
   * The two above are for a viewer allowed to change the page. In a room nobody
   * is: pressing ▶ proposes the next page to everyone else and the room decides.
   * That needs the number the step would land on before anything moves, which
   * `gotoNextNonEmpty` cannot give — by the time it returns, it has already gone.
   *
   * Same skipping rules, same wrap, so the two keys offer the room exactly the
   * page they would have jumped to on a set nobody had to agree with.
   */
  const peekNextNonEmpty = useCallback(
    () => nextNonEmptyPage(displayedPageNumber, pages ?? {}),
    [displayedPageNumber, pages],
  );

  const peekPrevNonEmpty = useCallback(
    () => prevNonEmptyPage(displayedPageNumber, pages ?? {}),
    [displayedPageNumber, pages],
  );

  return {
    displayedPageNumber,
    displayedSubpage,
    subpageCount,
    page,
    setDisplayedPage,
    setDisplayedPageDirect,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
    peekNextNonEmpty,
    peekPrevNonEmpty,
    stepSubpageBy,
  };
}
