/**
 * useGuide — playhtml binding for the TV_Guide of Page_Titles (Requirement 9).
 *
 * Each Page_Number can carry a human-readable Page_Title that members edit
 * collaboratively; the TV_Guide is a browsable listing of qualifying pages and
 * their titles that members consult while watching. This hook is a thin wrapper:
 * every decision (which entries qualify, title validation, trimming) is
 * delegated to the pure, framework-free `src/domain/guide.ts` and
 * `src/domain/titles.ts` modules so the behavior is exhaustively property-tested
 * (Properties 21, 22) without a live server.
 *
 * ## Binding approach
 *
 * Titles live in a single shared-state channel `"titles"` ({@link TitlesData},
 * default `{}`) bound via `usePageData`, which returns a `useState`-like
 * `[data, setData]` where `setData` accepts either a next value or an
 * immer-style `(draft) => void` mutator. Page content is read from the `"pages"`
 * channel (same {@link PAGES_CHANNEL} used by {@link useRoomSync}) so the guide
 * listing can include Non_Empty_Pages that have no title.
 *
 * ## Concurrent title edits converge (Req 9.12)
 *
 * `setTitle` writes a *single* title key (`titles[pageNumber]`) via the immer
 * mutator. Because each edit touches one key, two members editing *different*
 * pages' titles never collide, and two members editing the *same* page's title
 * write the *same* key and converge last-writer-wins via Yjs — satisfying the
 * requirement that concurrent title edits converge to the last applied value.
 *
 * ## Selection is the consumer's concern
 *
 * This hook only exposes the listing and title read/write; it never mutates any
 * room's displayed page. A room's TV Guide routes a selected Page_Number through
 * its voting flow at the call site (see {@link RoomViewer}), keeping this hook
 * free of any room dependency so it can be reused in the solo editor.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.12.
 */

import { useCallback, useMemo } from 'react';
import { usePageData } from '@playhtml/react';

import { guideEntries, type GuideEntry } from '../domain/guide';
import { readTitle, validateTitle } from '../domain/titles';
import { PAGES_CHANNEL } from './useRoomSync';
import type { PagesData, TitlesData } from './types';

/** Stable playhtml channel id for the per-room map of Page_Titles. */
export const TITLES_CHANNEL = 'titles';

/** Result of {@link GuideApi.setTitle} (delegates to `validateTitle`). */
export type SetTitleResult = 'ok' | 'too-long';

/**
 * Public TV_Guide API surface (see design.md "Shared-state hooks: useGuide").
 */
export interface GuideApi {
  /**
   * The TV_Guide listing: exactly the qualifying Page_Numbers (a Non_Empty_Page
   * or a Page_Title of length ≥ 1), each paired with its current Page_Title,
   * ordered strictly ascending by Page_Number (empty when none qualify).
   *
   * Req 9.7, 9.11, 9.13.
   */
  entries: GuideEntry[];
  /**
   * Read the current Page_Title for a Page_Number, defaulting to `''` (a
   * length-0 title) when none is stored. Req 9.2.
   */
  title(pageNumber: number): string;
  /**
   * Set the Page_Title for a Page_Number.
   *
   * Returns `'ok'` when the trimmed text is 0..60 characters — the trimmed value
   * is written to `titles[pageNumber]` (a whitespace-only/empty input yields a
   * length-0 title) — or `'too-long'` when the trimmed text exceeds 60
   * characters, in which case the current title is retained. Req 9.4, 9.6, 9.12.
   */
  setTitle(pageNumber: number, text: string): SetTitleResult;
}

/** Default titles data for a room with no stored Page_Titles. */
const DEFAULT_TITLES_DATA: TitlesData = {};

/** Default pages data for a room with no stored page content. */
const DEFAULT_PAGES_DATA: PagesData = {};

/**
 * Bind the GLOBAL TV_Guide state to playhtml and expose entries / title /
 * setTitle.
 *
 * Pages and titles are global shared content, so this hook is not room-scoped
 * and can be used from the solo editor as well as from a room's TV Guide.
 */
/**
 * Titles alone — reading one, and writing one.
 *
 * Split out of {@link useGuide} because of what the *listing* costs. Building
 * it walks 100..999 and calls `normalizePage` on every occupied page, which
 * allocates a fresh 960-cell array each time — on a full archive, most of a
 * million cell objects. It is memoised on `pages`, and `pages` gets a new
 * identity whenever *anyone* edits *any* page.
 *
 * So the editor, which wanted nothing but `title` and `setTitle`, rebuilt the
 * whole directory on every keystroke — including its own. Four of the six
 * callers were in that position. They take this instead, and never touch the
 * `pages` channel at all.
 */
export function usePageTitles(): Pick<GuideApi, 'title' | 'setTitle'> {
  const [titles, setTitles] = usePageData<TitlesData>(
    TITLES_CHANNEL,
    DEFAULT_TITLES_DATA,
  );

  // Read the current Page_Title, '' when unset (Req 9.2).
  const title = useCallback(
    (pageNumber: number): string => readTitle(titles, pageNumber),
    [titles],
  );

  const setTitle = useCallback(
    (pageNumber: number, text: string): SetTitleResult => {
      const result = validateTitle(text);
      if (!result.ok) {
        // Over-length: reject and retain the current title (Req 9.6).
        return 'too-long';
      }
      // Write a single title key so concurrent edits converge via Yjs LWW
      // (Req 9.4, 9.12). The trimmed value may be '' — a length-0 title.
      setTitles((draft) => {
        draft[pageNumber] = result.value;
      });
      return 'ok';
    },
    [setTitles],
  );

  return { title, setTitle };
}

export function useGuide(): GuideApi {
  const [titles] = usePageData<TitlesData>(TITLES_CHANNEL, DEFAULT_TITLES_DATA);
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, DEFAULT_PAGES_DATA);
  const { title, setTitle } = usePageTitles();

  // The qualifying, ascending-ordered listing (Req 9.7, 9.11, 9.13).
  const entries = useMemo<GuideEntry[]>(
    () =>
      guideEntries(pages ?? DEFAULT_PAGES_DATA, titles ?? DEFAULT_TITLES_DATA),
    [pages, titles],
  );

  return {
    entries,
    title,
    setTitle,
  };
}
