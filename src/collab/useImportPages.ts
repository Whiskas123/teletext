/**
 * useImportPages — write whole pages, in bulk, to the global `"pages"` channel.
 *
 * {@link useEditPage} is bound to one Page_Number and writes one cell per
 * call, which is right for a person typing: concurrent edits to different
 * cells both survive, and same-cell edits converge last-writer-wins. A batch
 * import is a different shape of write and wants different behaviour on both
 * counts:
 *
 * - **Whole pages, not cells.** An import *replaces* a page, so each page's
 *   cell map is assigned wholesale. A cell the render leaves empty must end up
 *   empty, which merging into the existing map would not achieve.
 * - **One transaction, not 960 per page.** Driving `editCell` in a loop is
 *   960 separate store writes for a single page, and a batch of twenty pages
 *   would be nineteen thousand. Here the entire batch is one mutation, so it
 *   reaches other sessions as one change rather than as a slow trickle of
 *   cells.
 *
 * Who is allowed to write which page is not decided here — that is
 * `domain/access.ts`, applied by the screen before it calls this.
 */

import { useCallback, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { isValidCell } from '../domain/cellEdit';
import { TOTAL_CELLS, type Cell, type PagesData, type TeletextPage } from './types';
import { PAGES_CHANNEL } from './useEditPage';

/** One page's worth of import: where it goes, and what goes there. */
export interface PageImport {
  pageNumber: number;
  page: TeletextPage;
}

export interface ImportPagesApi {
  /**
   * Replace each listed page with the given content, as a single store write.
   *
   * Returns the number of pages actually written. A page whose content is not
   * a full {@link TOTAL_CELLS}-cell array of valid cells is skipped rather
   * than written half-formed — the rest of the batch still goes through.
   */
  importPages(imports: readonly PageImport[]): number;
  /**
   * Non-null with an error indication when the last write failed; the caller's
   * in-memory batch is untouched either way, so it can be retried.
   */
  saveError: string | null;
}

/** Whether `page` is a complete page of cells this is willing to persist. */
function isCompletePage(page: TeletextPage): boolean {
  return (
    Array.isArray(page) &&
    page.length === TOTAL_CELLS &&
    page.every((cell) => cell != null && isValidCell(cell))
  );
}

export function useImportPages(): ImportPagesApi {
  const [, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});
  const [saveError, setSaveError] = useState<string | null>(null);

  const importPages = useCallback(
    (imports: readonly PageImport[]): number => {
      const writable = imports.filter(
        ({ pageNumber, page }) => Number.isInteger(pageNumber) && isCompletePage(page),
      );
      if (writable.length === 0) return 0;

      try {
        setPages((draft) => {
          for (const { pageNumber, page } of writable) {
            // A fresh map per page, replacing whatever was there: an imported
            // page is the render, not the render merged over the old content.
            const cellMap: Record<number, Cell> = {};
            for (let index = 0; index < TOTAL_CELLS; index += 1) {
              cellMap[index] = { ...page[index] };
            }
            draft[pageNumber] = cellMap;
          }
        });
        setSaveError(null);
        return writable.length;
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Import not saved');
        return 0;
      }
    },
    [setPages],
  );

  return { importPages, saveError };
}
