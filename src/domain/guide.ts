/**
 * Pure TV_Guide helpers for Collaborative Teletext Rooms.
 *
 * This module is framework-free and side-effect-free so it can be unit- and
 * property-tested without a live playhtml/Yjs connection. It reuses the shared
 * collaborative shapes (`PagesData`, `TitlesData`) from `src/collab/types.ts`
 * and the page predicate (`hasContentAt`) from `src/domain/pageOps.ts`.
 *
 * Requirements covered: 9.7, 9.11, 9.13.
 * Correctness property: 22 (guide listing has exactly the qualifying entries in
 * ascending order).
 */

import type { PagesData, TitlesData } from '../collab/types';
/*
 * The listing qualifies a page the same way the PAGE keys reach one — borrowed
 * rather than restated, because the two coming apart is exactly what put a
 * blank page in the directory and under the step keys at the same time. A row
 * leading to a blank screen is a dead end; see `hasVisibleContent`.
 */
import { hasContentAt } from './pageOps';

/** Lowest valid Page_Number (inclusive). Teletext pages run 100..999. */
const MIN_PAGE = 100;
/** Highest valid Page_Number (inclusive). */
const MAX_PAGE = 999;

/**
 * One listable row of the TV_Guide: the pairing of a Page_Number with its
 * current Page_Title (`''` when the page has no stored title).
 */
export interface GuideEntry {
  /** The Page_Number (`100..999`) this entry lists. */
  pageNumber: number;
  /** The current Page_Title, or `''` when none is stored. */
  title: string;
}

/** The current Page_Title stored for `n`, or `''` when absent/non-string. */
function titleAt(titles: TitlesData, n: number): string {
  const raw = titles
    ? (titles as Record<PropertyKey, unknown>)[n]
    : undefined;
  return typeof raw === 'string' ? raw : '';
}

/**
 * The TV_Guide listing: exactly the Page_Numbers in `100..999` that show
 * something OR have a Page_Title of length 1 or greater, each paired with
 * its current Page_Title (`''` when none), ordered strictly ascending by
 * Page_Number.
 *
 * Returns an empty array when no Page_Number qualifies.
 *
 * Requirements: 9.7 (qualifying entries, ascending), 9.11 (empty when none),
 * 9.13 (membership tracks qualification changes). Property 22.
 */
export function guideEntries(
  pages: PagesData,
  titles: TitlesData,
): GuideEntry[] {
  const entries: GuideEntry[] = [];
  for (let n = MIN_PAGE; n <= MAX_PAGE; n++) {
    const title = titleAt(titles, n);
    const qualifies = title.length >= 1 || hasContentAt(pages, n);
    if (qualifies) {
      entries.push({ pageNumber: n, title });
    }
  }
  return entries;
}
