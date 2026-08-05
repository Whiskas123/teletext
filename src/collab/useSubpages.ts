/**
 * useSubpages — how many screens each page number holds, and adding or removing
 * one.
 *
 * The count lives in its own global channel beside `titles`, `page-kinds` and
 * `descriptions`, for the same reason those do: it is per-page metadata that
 * has to move with a page when it is renumbered, has to survive in the backup,
 * and applies to hand-made pages as much as to archive ones.
 *
 * ## Why the count is stored rather than counted
 *
 * Deriving it from which keys exist in the `pages` channel looks simpler and
 * does not work, twice over:
 *
 * - A subpage that has just been added is **empty**. Counted by content it does
 *   not exist, so "Add subpage" would appear to do nothing.
 * - playhtml's draft is a Proxy with no `deleteProperty` trap, so `delete
 *   draft[key]` throws and aborts the whole mutation. Removing a subpage can
 *   only blank its cells, never take the key away — so a count derived from
 *   which keys are present could go up but never back down.
 *
 * Hence one stored number per page, with everything that reads it going through
 * `normalizeSubpageCount` so a malformed value costs a carousel rather than a
 * crash.
 */

import { useCallback } from 'react';
import { usePageData } from '@playhtml/react';

import {
  MAX_SUBPAGE,
  MIN_SUBPAGE,
  SUBPAGE_COUNTS_CHANNEL,
  pageKey,
  subpageCountOf,
  type SubpageCounts,
} from '../domain/subpages';
import { PAGES_CHANNEL } from './useEditPage';
import type { PagesData } from './types';

export interface SubpagesApi {
  /** The whole map, for the readers that need to walk it (backup, reordering). */
  counts: SubpageCounts;
  /** How many subpages `pageNumber` holds. Always at least 1. */
  countOf(pageNumber: number): number;
  /**
   * Append an empty subpage and return its number, or `null` when the page is
   * already at {@link MAX_SUBPAGE}.
   */
  addSubpage(pageNumber: number): number | null;
  /**
   * Drop the last subpage, blanking its cells, and return the new count — or
   * `null` when the page has only the one subpage, which is the page itself and
   * cannot be removed.
   */
  removeLastSubpage(pageNumber: number): number | null;
  /**
   * Set the count outright, clamped into range. Used by publishing, which may
   * put a capture on a subpage that does not exist yet.
   */
  setCount(pageNumber: number, count: number): void;
}

export function useSubpages(): SubpagesApi {
  const [counts, setCounts] = usePageData<SubpageCounts>(SUBPAGE_COUNTS_CHANNEL, {});
  const [, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});

  const countOf = useCallback(
    (pageNumber: number): number => subpageCountOf(counts, pageNumber),
    [counts],
  );

  const setCount = useCallback(
    (pageNumber: number, count: number) => {
      const clamped = Math.min(MAX_SUBPAGE, Math.max(MIN_SUBPAGE, Math.trunc(count)));
      setCounts((draft) => {
        draft[pageNumber] = clamped;
      });
    },
    [setCounts],
  );

  const addSubpage = useCallback(
    (pageNumber: number): number | null => {
      const next = subpageCountOf(counts, pageNumber) + 1;
      if (next > MAX_SUBPAGE) return null;

      setCounts((draft) => {
        draft[pageNumber] = next;
      });
      // Seeded empty so the key exists the moment the count claims it does.
      // Without this the editor would write into an absent key on its first
      // keystroke, which works — but the snapshot would miss a subpage that had
      // been added and not yet typed on.
      setPages((draft) => {
        draft[pageKey(pageNumber, next) as number] = {};
      });
      return next;
    },
    [counts, setCounts, setPages],
  );

  const removeLastSubpage = useCallback(
    (pageNumber: number): number | null => {
      const current = subpageCountOf(counts, pageNumber);
      if (current <= MIN_SUBPAGE) return null;

      // Blanked, not deleted: `delete` throws on playhtml's draft, and every
      // reader treats an empty cell map and an absent key identically.
      setPages((draft) => {
        draft[pageKey(pageNumber, current) as number] = {};
      });
      setCounts((draft) => {
        draft[pageNumber] = current - 1;
      });
      return current - 1;
    },
    [counts, setCounts, setPages],
  );

  return { counts: counts ?? {}, countOf, addSubpage, removeLastSubpage, setCount };
}
