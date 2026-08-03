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
  /** Set a page's kind. The default is stored like any other. */
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
        // The default is written rather than the key removed: playhtml's draft
        // is a Proxy with no `deleteProperty` trap, so `delete` throws and
        // aborts the mutation. `kindAt` reads a stored `page` and a missing
        // key identically, and `useOccupiedPages` counts only headings, so
        // nothing downstream can tell the difference.
        draft[pageNumber] = kind;
      });
    },
    [setKinds],
  );

  return { kinds: kinds ?? {}, kindOf, setKind };
}
