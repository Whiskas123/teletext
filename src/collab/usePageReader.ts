/**
 * usePageReader — any page's content, for the editor's "copy from".
 *
 * Reads through {@link useContentChannel} like every screen does, so curated
 * and playground pages are both there. Null when the page holds nothing: an
 * empty page copied onto a drawing would be a clear by another name.
 */

import { useCallback } from 'react';

import { isNonEmptyPage, normalizePage } from '../domain/pageOps';
import { pageKey } from '../domain/subpages';
import { useContentChannel } from './archiveStore';
import type { PagesData, TeletextPage } from './types';
import { PAGES_CHANNEL } from './useEditPage';

export function usePageReader(): (pageNumber: number, subpage: number) => TeletextPage | null {
  const pages = useContentChannel<PagesData>(PAGES_CHANNEL, {});
  return useCallback(
    (pageNumber, subpage) => {
      const stored = pages?.[pageKey(pageNumber, subpage) as number];
      if (stored == null) return null;
      const page = normalizePage(stored);
      return isNonEmptyPage(page) ? page : null;
    },
    [pages],
  );
}
