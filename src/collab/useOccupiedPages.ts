/**
 * useOccupiedPages — every page number that is claimed, from the live document.
 *
 * "Claimed" is deliberately broader than "has something drawn on it". A page
 * with a title but no cells belongs to whoever titled it, and a page marked as
 * a directory heading is a page too. Counting only cells has caused two bugs
 * already:
 *
 * - the management screen listed fewer pages than the Yellow Pages directory,
 *   because the directory qualifies a page on its title as well; and
 * - worse, that same undercount was fed to the reordering planner, so shifting
 *   a page could land on a title-only page and overwrite it.
 *
 * Hence one definition, in one place, used by everything that needs to know
 * which numbers are spoken for.
 *
 * ## Claimed is broader than visible, deliberately
 *
 * A page counts as claimed when any of its cells differs from the default
 * ({@link isNonEmptyPage}), not when it draws something
 * (`hasVisibleContent`). The two came apart on a page of coloured spaces:
 * the PAGE keys walked onto it because it held cells, while this screen never
 * listed it because it held no ink, so the one page a visitor could reach was
 * the one page an operator could not delete. Reaching is now the narrow
 * question and claiming the wide one, which is the way round that leaves
 * nothing stranded: anything a reader can land on is listed here, and so is
 * anything that would be overwritten by a shift.
 */

import { useMemo } from 'react';
import { usePageDataWithBoot } from './bootData';

import { isNonEmptyPage } from '../domain/pageOps';
import { pageToArray } from '../domain/pageEncoding';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import { PAGE_KINDS_CHANNEL } from './usePageKinds';
import { isHeadingKind, isPageKind, type PageKinds } from '../domain/directory';
import type { PagesData, TitlesData } from './types';

/** Ascending page numbers that hold content, a title, or a heading role. */
export function useOccupiedPages(): number[] {
  const [pages] = usePageDataWithBoot<PagesData>(PAGES_CHANNEL, {});
  const [titles] = usePageDataWithBoot<TitlesData>(TITLES_CHANNEL, {});
  const [kinds] = usePageDataWithBoot<PageKinds>(PAGE_KINDS_CHANNEL, {});

  return useMemo(() => {
    const occupied = new Set<number>();

    const asPage = (key: string): number | null => {
      const pageNumber = Number(key);
      return Number.isInteger(pageNumber) ? pageNumber : null;
    };

    for (const [key, stored] of Object.entries(pages ?? {})) {
      const pageNumber = asPage(key);
      if (pageNumber == null) continue;
      // A key whose cells are all the default one is an empty slot, not a
      // claim — clearing a page leaves the key behind, and `deletePage` frees
      // a number by writing an empty map rather than by removing the key.
      if (isNonEmptyPage(pageToArray(stored))) {
        occupied.add(pageNumber);
      }
    }

    for (const [key, title] of Object.entries(titles ?? {})) {
      const pageNumber = asPage(key);
      if (pageNumber != null && typeof title === 'string' && title.trim().length > 0) {
        occupied.add(pageNumber);
      }
    }

    for (const [key, kind] of Object.entries(kinds ?? {})) {
      const pageNumber = asPage(key);
      // Only a heading claims a page. `page` is the default and `setKind`
      // removes the key rather than storing it, but counting a stored `page`
      // as occupancy would make a page impossible to free again.
      if (pageNumber != null && isPageKind(kind) && isHeadingKind(kind)) {
        occupied.add(pageNumber);
      }
    }

    return [...occupied].sort((a, b) => a - b);
  }, [pages, titles, kinds]);
}
