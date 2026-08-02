/**
 * usePageKinds — whether each page is a category, a subcategory, or a page.
 *
 * This is what gives the Yellow Pages directory its shape (see
 * `domain/directory.ts`), and it lives in playhtml rather than in Postgres for
 * two reasons:
 *
 * - **The directory is a public read path.** Yellow Pages is shown to every
 *   visitor and reads the live document; making it call the database would put
 *   the archive's system of record in front of ordinary browsing, which nothing
 *   else does.
 * - **It applies to every page, not just archive ones.** Pages made by hand and
 *   the whole playground exist only in the live document, and they belong in
 *   the directory too.
 *
 * Kinds are keyed by page number, exactly like titles, so a renumbering moves
 * both together — see the reorder replay in `useArchiveAdmin`.
 */

import { useCallback } from 'react';
import { usePageData } from '@playhtml/react';

import {
  DEFAULT_PAGE_KIND,
  isPageKind,
  kindAt,
  type PageKind,
  type PageKinds,
} from '../domain/directory';

/** Stable playhtml channel id for the map of page kinds. */
export const PAGE_KINDS_CHANNEL = 'page-kinds';

export interface PageKindsApi {
  /** Every stored kind, keyed by page number. */
  kinds: PageKinds;
  /** The kind of one page, defaulting to an ordinary page. */
  kindOf(pageNumber: number): PageKind;
  /**
   * Set a page's kind. Writing the default removes the key rather than storing
   * it, so the channel holds only the headings — which are the exception.
   */
  setKind(pageNumber: number, kind: PageKind): void;
}

export function usePageKinds(): PageKindsApi {
  const [kinds, setKinds] = usePageData<PageKinds>(PAGE_KINDS_CHANNEL, {});

  const kindOf = useCallback(
    (pageNumber: number): PageKind => kindAt(kinds, pageNumber),
    [kinds],
  );

  const setKind = useCallback(
    (pageNumber: number, kind: PageKind) => {
      if (!Number.isInteger(pageNumber) || !isPageKind(kind)) return;
      // One key per page, so two people marking different pages never collide
      // and two marking the same one converge last-writer-wins — the same
      // reason titles are stored this way.
      setKinds((draft) => {
        if (kind === DEFAULT_PAGE_KIND) delete draft[pageNumber];
        else draft[pageNumber] = kind;
      });
    },
    [setKinds],
  );

  return { kinds: kinds ?? {}, kindOf, setKind };
}
