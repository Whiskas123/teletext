/**
 * useEditPage — playhtml binding for SOLO editing of a GLOBAL teletext page
 * (Requirements 6 and 7).
 *
 * Teletext pages are global shared content: anyone can edit a page on its own,
 * in a dedicated clutter-free editor, and the edit persists globally so it shows
 * up wherever the page is watched. This hook binds that editing to the single
 * global `"pages"` channel; the decision logic (cell validation) delegates to
 * the pure, framework-free `src/domain/cellEdit.ts` and `src/domain/pageOps.ts`
 * modules so the behavior is unit- and property-testable without a live Yjs
 * connection.
 *
 * ## Critical design choice: page stored as a cell-indexed map
 *
 * Pages are persisted in the shared `"pages"` channel as
 * {@link PagesData} = `Record<pageNumber, PageCellMap>`, where a
 * {@link PageCellMap} is `Record<cellIndex 0..959, Cell>`. `editCell` writes
 * **only the single changed cell key** through an immer-style mutator:
 *
 * ```ts
 * setPages((draft) => {
 *   (draft[pageNumber] ??= {})[index] = cell; // one key written
 * });
 * ```
 *
 * Because the store is Yjs-backed, concurrent edits to **different** cells write
 * **different** keys → both survive the merge (Req 6.2); edits to the **same**
 * cell write the **same** key → Yjs resolves last-writer-wins and every replica
 * converges (Req 6.3, 8.5). The positional 960-cell {@link TeletextPage} the UI
 * renders is reconstructed by {@link normalizePage} (missing keys → empty
 * cells), always yielding exactly 960 valid cells (Req 6.4, 7.7).
 *
 * Editing is solo — there is no chat, voting, presence or cursor layer here.
 *
 * Requirements covered: 6.1, 6.2, 6.3, 6.4, 6.7, 7.2, 7.3, 7.4, 7.7, 7.8, 7.9.
 */

import { useCallback, useMemo, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { isValidCell } from '../domain/cellEdit';
import { normalizePage } from '../domain/pageOps';
import {
  TOTAL_CELLS,
  type Cell,
  type PagesData,
  type TeletextPage,
} from './types';

/** Stable playhtml channel id for the GLOBAL map of page content. */
export const PAGES_CHANNEL = 'pages';

/**
 * Result of an {@link EditPageApi.editCell} request.
 *
 * `'ok'` when the edit was valid and written to the shared page; `'invalid'`
 * when the cell is malformed or the index is out of range, in which case the
 * cell retains its current value (Req 6.7).
 */
export type EditCellResult = 'ok' | 'invalid';

/**
 * Public editing API surface.
 */
export interface EditPageApi {
  /** Normalized 960-cell page for the edited Page_Number (Req 6.4, 7.4, 7.7). */
  page: TeletextPage;
  /**
   * Apply a single cell edit. Returns `'ok'` when the cell is valid and the
   * index is in `0..959` (the change is persisted to the shared page), or
   * `'invalid'` otherwise (a no-op that retains the cell's value; Req 6.1, 6.7).
   */
  editCell(index: number, cell: Cell): EditCellResult;
  /**
   * Non-null with an error indication when the last persist attempt failed;
   * the member's in-editor edits are retained regardless (Req 7.9). `null`
   * while writes are succeeding.
   */
  saveError: string | null;
}

/** Whether `index` is a valid cell index: an integer in `0..959`. */
function isCellIndexInRange(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < TOTAL_CELLS;
}

/**
 * Bind solo editing of a single GLOBAL Page_Number to playhtml.
 *
 * @param pageNumber the Page_Number being edited (assumed a valid 1..999 page).
 */
export function useEditPage(pageNumber: number): EditPageApi {
  const [pages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});

  const [saveError, setSaveError] = useState<string | null>(null);

  // Normalize the stored cell-indexed map (or absent entry) into a valid
  // 960-cell page for rendering (Req 6.4, 7.4, 7.7).
  const page = useMemo<TeletextPage>(
    () => normalizePage(pages ? pages[pageNumber] : undefined),
    [pages, pageNumber],
  );

  const editCell = useCallback(
    (index: number, cell: Cell): EditCellResult => {
      // Reject malformed cells and out-of-range indices as a no-op (Req 6.7).
      if (!isCellIndexInRange(index) || !isValidCell(cell)) {
        return 'invalid';
      }

      try {
        // Write ONLY the single changed cell key into the page's cell-indexed
        // map so concurrent edits to different cells both survive and same-cell
        // edits converge last-writer-wins via Yjs (Req 6.2, 6.3, 6.5). The write
        // sets exactly one key (draft[pageNumber][index]); the positional page
        // invariant (960 cells, other cells retained) is guaranteed on read by
        // normalizePage.
        setPages((draft) => {
          let cellMap = draft[pageNumber];
          if (cellMap == null) {
            cellMap = {};
            draft[pageNumber] = cellMap;
          }
          // Store a plain clone of the validated cell under its index key. This
          // persists the change to the Playhtml_Store (Req 6.1, 7.2, 7.3) and
          // propagates it to other sessions (Req 7.8).
          cellMap[index] = { ...cell };
        });
        // Clear any prior save error on a successful write (Req 7.9).
        setSaveError(null);
      } catch (error) {
        // Best-effort persistence: keep the member's edits and surface an
        // error indication without throwing (Req 7.9).
        setSaveError(
          error instanceof Error ? error.message : 'Change not saved',
        );
      }

      return 'ok';
    },
    [setPages, pageNumber],
  );

  return { page, editCell, saveError };
}
