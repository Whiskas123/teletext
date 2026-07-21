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
import { useRoomId } from './RoomContext';
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

  // Guard against a malformed/absent sync value (e.g. before first sync), so the
  // default page 100 is always presented (Req 3.4).
  const displayedPageNumber =
    sync && Number.isInteger(sync.displayedPageNumber)
      ? sync.displayedPageNumber
      : DEFAULT_DISPLAYED_PAGE;

  // Normalize the stored page (or absent entry) to a valid 960-cell page (Req 7.4).
  const page = useMemo<TeletextPage>(
    () => normalizePage(pages ? pages[displayedPageNumber] : undefined),
    [pages, displayedPageNumber],
  );

  const setDisplayedPageDirect = useCallback(
    (n: number) => {
      setSync((draft) => {
        draft.displayedPageNumber = n;
      });
    },
    [setSync],
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

  return {
    displayedPageNumber,
    page,
    setDisplayedPage,
    setDisplayedPageDirect,
    gotoNextNonEmpty,
    gotoPrevNonEmpty,
  };
}
