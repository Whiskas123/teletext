/**
 * Finding a page by what is written on it.
 *
 * Shared by the room's {@link PageSearch} popup and by the search field built
 * into the solo viewer's directory leaflet, which are the same question asked
 * from two places. The rows that show the answer are in {@link searchResults};
 * the matching itself is in `domain/pageSearch.ts` — reading text back out of a
 * 40x24 grid has enough teletext-specific catches (graphics cells, layout
 * padding, Portuguese accents) to be worth testing on its own.
 */

import { useMemo } from 'react';
import { usePageData } from '@playhtml/react';

import { useGuide } from '../../collab/useGuide';
import { PAGES_CHANNEL } from '../../collab/useEditPage';
import { useSubpages } from '../../collab/useSubpages';
import { pageKeys } from '../../domain/subpages';
import type { PagesData } from '../../collab/types';
import { searchPages, type SearchHit } from '../../domain/pageSearch';

/**
 * Every page whose text matches `query`, best first.
 *
 * Searched over the guide's listing rather than every key in the document, so a
 * page that is empty and untitled — a slot someone cleared — is not a result.
 * The guide is already the definition of "a page that exists".
 *
 * Each listing contributes every screen of its carousel, because a long story
 * lives on the later ones and they are exactly what is hard to find by arrowing
 * through pages.
 */
export function usePageSearchHits(query: string): SearchHit[] {
  const { entries } = useGuide();
  const [pages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const { countOf } = useSubpages();

  return useMemo(
    () =>
      searchPages(
        entries.flatMap((entry) =>
          pageKeys(entry.pageNumber, countOf(entry.pageNumber)).map((key, index) => ({
            pageNumber: entry.pageNumber,
            subpage: index + 1,
            title: entry.title,
            page: pages?.[key as number],
          })),
        ),
        query,
      ),
    [entries, pages, countOf, query],
  );
}
