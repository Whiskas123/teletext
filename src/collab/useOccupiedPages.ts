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
 */

import { useMemo } from 'react';
import { usePageData } from '@playhtml/react';

import { pageToArray } from '../domain/pageEncoding';
import { PAGES_CHANNEL } from './useEditPage';
import { TITLES_CHANNEL } from './useGuide';
import { PAGE_KINDS_CHANNEL } from './usePageKinds';
import { isHeadingKind, isPageKind, type PageKinds } from '../domain/directory';
import type { PagesData, TitlesData } from './types';

/** Ascending page numbers that hold content, a title, or a heading role. */
export function useOccupiedPages(): number[] {
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [titles] = usePageData<TitlesData>(TITLES_CHANNEL, {});
  const [kinds] = usePageData<PageKinds>(PAGE_KINDS_CHANNEL, {});

  return useMemo(() => {
    const occupied = new Set<number>();

    const asPage = (key: string): number | null => {
      const pageNumber = Number(key);
      return Number.isInteger(pageNumber) ? pageNumber : null;
    };

    for (const [key, stored] of Object.entries(pages ?? {})) {
      const pageNumber = asPage(key);
      if (pageNumber == null) continue;
      // A key with no ink is an empty slot, not content — clearing a page
      // leaves the key behind.
      const page = pageToArray(stored);
      if (page.some((cell) => cell.char !== ' ' || cell.graphics != null)) {
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
