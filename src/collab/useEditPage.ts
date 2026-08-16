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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageData } from '@playhtml/react';

import { isValidCell } from '../domain/cellEdit';
import { normalizePage } from '../domain/pageOps';
import { reuseUnchangedCells } from '../domain/pageReuse';
import { MIN_SUBPAGE, pageKey } from '../domain/subpages';
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
 * @param subpage which screen of that page's carousel, defaulting to the first.
 *   Only the key changes: a subpage is a whole page in its own right, so every
 *   merge guarantee above holds per subpage rather than per page number (see
 *   `domain/subpages.ts`).
 */
export function useEditPage(
  pageNumber: number,
  subpage: number = MIN_SUBPAGE,
): EditPageApi {
  const [pages, setPages] = usePageData<PagesData>(PAGES_CHANNEL, {});

  const [saveError, setSaveError] = useState<string | null>(null);

  const key = pageKey(pageNumber, subpage) as number;

  /**
   * This page's stored cells, pulled out before the memo.
   *
   * The `pages` channel is the whole document, so its identity changes when
   * *anyone* edits *any* page. Keying the memo on `pages` therefore rebuilt all
   * 960 cells whenever someone typed on a different page entirely. Keying it on
   * this page's own entry means an edit elsewhere costs a render that reuses the
   * page it already had.
   */
  const stored = pages ? pages[key] : undefined;

  /**
   * The page as last handed out, so unchanged cells keep their identity.
   *
   * `normalizePage` builds 960 fresh objects every time it runs, which makes
   * every cell a changed prop and every keystroke a 960-cell re-render. Holding
   * the previous result and reusing the cells that are equal to it is what lets
   * the grid re-render only the cells a stroke actually touched — see
   * `domain/pageReuse.ts`.
   *
   * A ref rather than state: it is a cache of what was already returned, not a
   * value anything should re-render to see.
   */
  const previousPageRef = useRef<TeletextPage | null>(null);

  // Normalize the stored cell-indexed map (or absent entry) into a valid
  // 960-cell page for rendering (Req 6.4, 7.4, 7.7).
  const page = useMemo<TeletextPage>(() => {
    /*
     * Reading and writing a ref while rendering, which `react-hooks/refs`
     * forbids and which is *safe here specifically*.
     *
     * The rule guards against a render being discarded — under concurrent
     * rendering React may throw one away — leaving a ref holding something that
     * was never shown. That is a bug when correctness depends on the ref's
     * contents. It does not here: the cache is only ever consulted through a
     * *value* comparison, so the worst a discarded render can do is offer cells
     * from a page nobody saw, and a cell equal in every field to the one being
     * rendered is indistinguishable from it. The page produced is identical
     * either way; only the identity-sharing, which is an optimisation, varies.
     *
     * The sanctioned alternative — deriving the cache with `useState` and
     * setting it during render — costs a second pass through this hook on every
     * keystroke, in the exact path being optimised.
     */
    // eslint-disable-next-line react-hooks/refs
    const normalized = reuseUnchangedCells(normalizePage(stored), previousPageRef.current);
    // eslint-disable-next-line react-hooks/refs
    previousPageRef.current = normalized;
    return normalized;
  }, [stored]);

  // A different page shares nothing with the last one; keeping its cells would
  // only make the comparison do work that cannot succeed.
  useEffect(() => {
    previousPageRef.current = null;
  }, [key]);

  /**
   * Cells edited but not yet written, and which page they belong to.
   *
   * A stroke of the brush is not one cell. Since the editor started
   * interpolating between pointer samples (`domain/strokeLine.ts`) a single
   * `mousemove` can cover half a dozen cells, and each one used to be its own
   * `setPages` — its own Yjs transaction, its own state update, and its own
   * re-render of all 960 cells. Six of those inside one event is what made a
   * quick stroke lag behind the pointer.
   *
   * They are collected here instead and written together.
   */
  const pendingRef = useRef<{ key: number; cells: Map<number, Cell> } | null>(null);
  const flushScheduledRef = useRef(false);

  const writePending = useCallback(() => {
    flushScheduledRef.current = false;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending == null || pending.cells.size === 0) return;

    try {
      // Still one key per cell, so the merge guarantees above are untouched:
      // concurrent edits to different cells write different keys and both
      // survive, same-cell edits converge last-writer-wins. What changed is
      // only how many of those keys are written per transaction.
      setPages((draft) => {
        let cellMap = draft[pending.key];
        if (cellMap == null) {
          cellMap = {};
          draft[pending.key] = cellMap;
        }
        for (const [index, cell] of pending.cells) {
          cellMap[index] = { ...cell };
        }
      });
      // Clear any prior save error on a successful write (Req 7.9).
      setSaveError(null);
    } catch (error) {
      // Best-effort persistence: keep the member's edits and surface an
      // error indication without throwing (Req 7.9).
      setSaveError(error instanceof Error ? error.message : 'Change not saved');
    }
  }, [setPages]);

  const editCell = useCallback(
    (index: number, cell: Cell): EditCellResult => {
      // Reject malformed cells and out-of-range indices as a no-op (Req 6.7).
      if (!isCellIndexInRange(index) || !isValidCell(cell)) {
        return 'invalid';
      }

      // Edits waiting for a different page belong to that page: write them
      // where they were made before starting a batch for this one.
      if (pendingRef.current != null && pendingRef.current.key !== key) {
        writePending();
      }
      if (pendingRef.current == null) {
        pendingRef.current = { key, cells: new Map() };
      }
      pendingRef.current.cells.set(index, cell);

      /*
       * Flushed on the microtask queue, not on a frame.
       *
       * A microtask runs as soon as the current event handler finishes, so an
       * edit is in the store before the next pointer event is delivered — the
       * painters read the page back to decide what to write (the pixel brush
       * changes one sixth and keeps the other five), and deferring across
       * frames would let two events in one frame read the same stale cell and
       * the second would undo the first.
       */
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        queueMicrotask(writePending);
      }

      return 'ok';
    },
    [key, writePending],
  );

  // Nothing in hand when the editor goes away, or when it moves to another
  // page: an unflushed stroke would simply be lost.
  useEffect(() => writePending, [writePending, key]);

  return { page, editCell, saveError };
}
