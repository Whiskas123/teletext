/**
 * Archive vs. playground access rules.
 *
 * The Page_Number range 100..999 (see `pageOps.ts`) is split in two:
 *
 * - **Archive** (100..{@link PLAYGROUND_MIN_PAGE} - 1): curated content —
 *   seeded pages and, eventually, an imported PNG archive. Only a moderator
 *   may edit or clear these pages.
 * - **Playground** ({@link PLAYGROUND_MIN_PAGE}..999): open to everyone.
 *
 * This module is pure and framework-free, like the rest of `src/domain/`, so
 * the boundary itself is exercised by a property test without any editor or
 * moderator-auth plumbing. It only decides *whether a page number may be
 * edited*; enforcing that decision (which page numbers the editor's page
 * picker will accept) lives in `SoloEditor`.
 */

import { MAX_PAGE, MIN_PAGE } from './pageOps';

/** First Page_Number in the open playground; everything below it is archive. */
export const PLAYGROUND_MIN_PAGE = 700;

/**
 * Whether `pageNumber` falls in the curated archive range (100..
 * {@link PLAYGROUND_MIN_PAGE} - 1). Page numbers outside the valid 100..999
 * range are never archive pages — they aren't valid pages at all.
 */
export function isArchivePage(pageNumber: number): boolean {
  return (
    Number.isInteger(pageNumber) &&
    pageNumber >= MIN_PAGE &&
    pageNumber < PLAYGROUND_MIN_PAGE
  );
}

/**
 * Whether `pageNumber` may be edited by the current member.
 *
 * A moderator may edit any valid page. Everyone else may edit only playground
 * pages ({@link PLAYGROUND_MIN_PAGE}..{@link MAX_PAGE}) — archive pages are
 * read-only for them, regardless of whether `pageNumber` itself is in range
 * (an out-of-range number is simply not editable by anyone).
 */
export function canEditPage(pageNumber: number, isModerator: boolean): boolean {
  if (!Number.isInteger(pageNumber) || pageNumber < MIN_PAGE || pageNumber > MAX_PAGE) {
    return false;
  }
  return isModerator || !isArchivePage(pageNumber);
}
